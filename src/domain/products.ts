import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError } from "@/lib/errors";
import { toFixed2 } from "@/lib/money";
import { entityId, gstRate, hsnCode, money, nonNegativeQuantity, parseInput, positiveInt, requiredText } from "@/lib/validation";

export const productSchema = z.object({
  // The item code is optional: the name is enough to tell items apart.
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => v === undefined || /^[A-Z0-9][A-Z0-9_/-]{0,39}$/.test(v), "Code may use letters, digits, - _ / (max 40)"),
  name: requiredText("Name", 120).transform(tidyName),
  unit: z.string().trim().min(1).max(20).default("pcs"),
  qtyPerCarton: positiveInt.default(1),
  hsnCode,
  unitPrice: money,
  gstRate,
  reorderLevel: nonNegativeQuantity.default("0"),
});

/** Collapses stray spaces and line breaks (names pasted from Excel often have them). */
export function tidyName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function toData(input: z.output<typeof productSchema>) {
  return { ...input, sku: input.sku ?? null, unitPrice: toFixed2(input.unitPrice), gstRate: toFixed2(input.gstRate), reorderLevel: toFixed2(input.reorderLevel) };
}

async function assertSkuFree(sku: string | undefined, exceptId?: string) {
  if (!sku) return;
  const clash = await prisma.product.findUnique({ where: { sku } });
  if (clash && clash.id !== exceptId) throw new DomainError("DUPLICATE_SKU", `Code ${sku} is already used by "${clash.name}".`);
}

/** Two active items with the same name could not be told apart on a bill, so the name must be unique. */
async function assertNameFree(name: string, exceptId?: string) {
  const clash = await prisma.product.findFirst({ where: { name: { equals: name, mode: "insensitive" }, isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) throw new DomainError("DUPLICATE_NAME", `An item named "${clash.name}" already exists. Give this one a different name so they are not mixed up.`);
}

export async function createProduct(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(productSchema, rawInput);
  await assertSkuFree(input.sku);
  await assertNameFree(input.name);
  return prisma.product.create({ data: toData(input) });
}

export async function updateProduct(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { id, ...input } = parseInput(productSchema.extend({ id: entityId }), rawInput);
  if (!(await prisma.product.findUnique({ where: { id } }))) throw new NotFoundError("Product");
  await assertSkuFree(input.sku, id);
  await assertNameFree(input.name, id);
  return prisma.product.update({ where: { id }, data: toData(input) });
}

/** Changes only the name. Bills already made keep the name they were printed with. */
export async function renameProduct(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { id, name } = parseInput(z.object({ id: entityId, name: requiredText("Name", 120).transform(tidyName) }), rawInput);
  if (!(await prisma.product.findUnique({ where: { id } }))) throw new NotFoundError("Product");
  await assertNameFree(name, id);
  return prisma.product.update({ where: { id }, data: { name } });
}

/**
 * Sets how many pieces make one carton for this item. Stock is always kept in pieces, so only the way it is shown
 * (and how cartons typed on new bills and orders turn into pieces) changes. Bills already made keep their own figure.
 */
export async function setCartonSize(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { id, qtyPerCarton } = parseInput(z.object({ id: entityId, qtyPerCarton: positiveInt }), rawInput);
  if (!(await prisma.product.findUnique({ where: { id } }))) throw new NotFoundError("Product");
  return prisma.product.update({ where: { id }, data: { qtyPerCarton } });
}

/**
 * Changes the rate (price before GST) and/or the name of one item in a single step, for the quick-edit table.
 * Only future bills use the new rate; bills already made keep the rate they were printed with.
 */
export async function quickEditProduct(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(
    z.object({ id: entityId, name: requiredText("Name", 120).transform(tidyName).optional(), unitPrice: money.optional() })
      .refine((v) => v.name !== undefined || v.unitPrice !== undefined, "Nothing to change."),
    rawInput
  );
  const current = await prisma.product.findUnique({ where: { id: input.id } });
  if (!current) throw new NotFoundError("Product");
  if (input.name !== undefined && input.name !== current.name) await assertNameFree(input.name, input.id);
  return prisma.product.update({
    where: { id: input.id },
    data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.unitPrice !== undefined ? { unitPrice: toFixed2(input.unitPrice) } : {}) },
  });
}

export async function setProductActive(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(z.object({ id: entityId, isActive: z.boolean() }), rawInput);
  return prisma.product.update({ where: { id: input.id }, data: { isActive: input.isActive } });
}

export async function listProducts(session: Session | null, rawInput: unknown = {}) {
  requireRole(session, ["OWNER"]); // returns prices, so workers use getStockOverview instead
  const input = parseInput(z.object({ search: z.string().trim().optional(), includeInactive: z.boolean().default(false) }), rawInput);
  return prisma.product.findMany({
    where: {
      ...(input.includeInactive ? {} : { isActive: true }),
      ...(input.search
        ? { OR: [{ name: { contains: input.search, mode: "insensitive" } }, { sku: { contains: input.search, mode: "insensitive" } }] }
        : {}),
    },
    orderBy: { name: "asc" },
  });
}
