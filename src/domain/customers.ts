import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError } from "@/lib/errors";
import { stateCodeFromGstin } from "@/lib/gst";
import { entityId, optionalGstin, parseInput, requiredText, stateCode } from "@/lib/validation";

const optionalPhone = z
  .string()
  .optional()
  .transform((v) => v?.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "") || undefined)
  .refine((v) => v === undefined || /^[6-9]\d{9}$/.test(v), "Enter a 10-digit mobile number or leave it empty");

const customerFields = z.object({
  name: requiredText("Name", 150),
  phone: optionalPhone,
  gstin: optionalGstin,
  billingAddress: requiredText("Address", 300),
  stateCode,
});

const stateMatchesGstin = (c: { gstin?: string; stateCode: string }) => !c.gstin || stateCodeFromGstin(c.gstin) === c.stateCode;
const STATE_MISMATCH = { message: "State must match the first two digits of the GSTIN", path: ["stateCode"] };

export const customerSchema = customerFields.refine(stateMatchesGstin, STATE_MISMATCH);
const updateCustomerSchema = customerFields.extend({ id: entityId }).refine(stateMatchesGstin, STATE_MISMATCH);

async function assertGstinFree(gstin: string | undefined, exceptId?: string) {
  if (!gstin) return;
  const clash = await prisma.customer.findUnique({ where: { gstin } });
  if (clash && clash.id !== exceptId) throw new DomainError("DUPLICATE_GSTIN", `GSTIN already belongs to "${clash.name}".`);
}

export async function createCustomer(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(customerSchema, rawInput);
  await assertGstinFree(input.gstin);
  return prisma.customer.create({ data: { ...input, phone: input.phone ?? null, gstin: input.gstin ?? null } });
}

export async function updateCustomer(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { id, ...input } = parseInput(updateCustomerSchema, rawInput);
  if (!(await prisma.customer.findUnique({ where: { id } }))) throw new NotFoundError("Customer");
  await assertGstinFree(input.gstin, id);
  return prisma.customer.update({ where: { id }, data: { ...input, phone: input.phone ?? null, gstin: input.gstin ?? null } });
}

export async function setCustomerActive(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(z.object({ id: entityId, isActive: z.boolean() }), rawInput);
  return prisma.customer.update({ where: { id: input.id }, data: { isActive: input.isActive } });
}

export async function searchCustomers(session: Session | null, rawInput: unknown = {}) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(
    z.object({ query: z.string().trim().optional(), limit: z.number().int().min(1).max(500).default(20), includeInactive: z.boolean().default(false) }),
    rawInput
  );
  const q = input.query;
  return prisma.customer.findMany({
    where: {
      ...(input.includeInactive ? {} : { isActive: true }),
      ...(q
        ? { OR: [
            { name: { contains: q, mode: "insensitive" } },
            { phone: { contains: q.replace(/\D/g, "") || q } },
            { gstin: { contains: q.toUpperCase() } },
          ] }
        : {}),
    },
    orderBy: { name: "asc" },
    take: input.limit,
  });
}
