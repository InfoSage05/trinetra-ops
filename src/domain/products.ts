import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError } from "@/lib/errors";
import { toFixed2 } from "@/lib/money";
import { entityId, gstRate, hsnCode, money, nonNegativeQuantity, parseInput, positiveInt, requiredText } from "@/lib/validation";

export const productSchema = z.object({
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_/-]{0,39}$/, "SKU may use letters, digits, - _ / (max 40)"),
  name: requiredText("Name", 120),
  unit: z.string().trim().min(1).max(20).default("pcs"),
  qtyPerCarton: positiveInt.default(1),
  hsnCode,
  unitPrice: money,
  gstRate,
  reorderLevel: nonNegativeQuantity.default("0"),
});

function toData(input: z.output<typeof productSchema>) {
  return { ...input, unitPrice: toFixed2(input.unitPrice), gstRate: toFixed2(input.gstRate), reorderLevel: toFixed2(input.reorderLevel) };
}

async function assertSkuFree(sku: string, exceptId?: string) {
  const clash = await prisma.product.findUnique({ where: { sku } });
  if (clash && clash.id !== exceptId) throw new DomainError("DUPLICATE_SKU", `SKU ${sku} is already used by "${clash.name}".`);
}

export async function createProduct(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(productSchema, rawInput);
  await assertSkuFree(input.sku);
  return prisma.product.create({ data: toData(input) });
}

export async function updateProduct(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { id, ...input } = parseInput(productSchema.extend({ id: entityId }), rawInput);
  if (!(await prisma.product.findUnique({ where: { id } }))) throw new NotFoundError("Product");
  await assertSkuFree(input.sku, id);
  return prisma.product.update({ where: { id }, data: toData(input) });
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
