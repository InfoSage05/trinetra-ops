import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError } from "@/lib/errors";
import { D, ZERO, round2, toFixed2 } from "@/lib/money";
import type { Prisma } from "@/generated/prisma/client";
import { RATE_TIERS, type RateTier } from "@/lib/rates";
import { entityId, gstRate, hsnCode, money, nonNegativeQuantity, parseInput, positiveInt, requiredText } from "@/lib/validation";

/** An optional rate: empty means "not set" (the item then uses Rate B for that tier). */
const optionalRate = z.preprocess((v) => (v === "" || v === null ? undefined : v), money.optional());

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
  rateA: optionalRate,
  rateC: optionalRate,
  gstRate,
  reorderLevel: nonNegativeQuantity.default("0"),
});

/** Collapses stray spaces and line breaks (names pasted from Excel often have them). */
export function tidyName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function toData(input: z.output<typeof productSchema>) {
  return { ...input, sku: input.sku ?? null, unitPrice: toFixed2(input.unitPrice), rateA: input.rateA ? toFixed2(input.rateA) : null, rateC: input.rateC ? toFixed2(input.rateC) : null, gstRate: toFixed2(input.gstRate), reorderLevel: toFixed2(input.reorderLevel) };
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

type RateSet = { A: string | null; B: string | null; C: string | null };
const ratesOf = (p: { unitPrice: { toString(): string }; rateA: { toString(): string } | null; rateC: { toString(): string } | null }): RateSet => ({
  A: p.rateA ? p.rateA.toString() : null, B: p.unitPrice.toString(), C: p.rateC ? p.rateC.toString() : null,
});
const sameRate = (a: string | null, b: string | null) => (a === null || b === null ? a === b : D(a).equals(D(b)));

/** Writes one history row for each rate that really changed. */
async function recordRateChanges(tx: Prisma.TransactionClient, productId: string, before: RateSet, after: RateSet, userId: string, reason?: string) {
  const rows = RATE_TIERS.filter((t) => !sameRate(before[t], after[t])).map((tier) => ({
    productId, tier, oldRate: before[tier], newRate: after[tier], reason: reason ?? null, changedBy: userId,
  }));
  if (rows.length > 0) await tx.productRateChange.createMany({ data: rows });
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
  const current = await prisma.product.findUnique({ where: { id } });
  if (!current) throw new NotFoundError("Product");
  await assertSkuFree(input.sku, id);
  await assertNameFree(input.name, id);
  const data = toData(input);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({ where: { id }, data });
    await recordRateChanges(tx, id, ratesOf(current), ratesOf(updated), session.userId);
    return updated;
  });
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

/** For the quick-edit table: undefined = leave as is, "" = clear (Rate A and C only), a number = set. */
const rateEdit = z.preprocess((v) => (v === "" ? null : v), money.nullable().optional());

/**
 * Changes the name and/or any of the three rates (A, B, C) of one item in a single step. Only future bills use a new
 * rate; bills already made keep the rate they were printed with. Every rate change is written to the rate history.
 */
export async function quickEditProduct(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(
    z.object({
      id: entityId,
      name: requiredText("Name", 120).transform(tidyName).optional(),
      unitPrice: money.optional(), // Rate B
      rateA: rateEdit,
      rateC: rateEdit,
      reason: z.string().trim().max(200).optional(),
    }).refine((v) => v.name !== undefined || v.unitPrice !== undefined || v.rateA !== undefined || v.rateC !== undefined, "Nothing to change."),
    rawInput
  );
  const current = await prisma.product.findUnique({ where: { id: input.id } });
  if (!current) throw new NotFoundError("Product");
  if (input.name !== undefined && input.name !== current.name) await assertNameFree(input.name, input.id);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: input.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.unitPrice !== undefined ? { unitPrice: toFixed2(input.unitPrice) } : {}),
        ...(input.rateA !== undefined ? { rateA: input.rateA === null ? null : toFixed2(input.rateA) } : {}),
        ...(input.rateC !== undefined ? { rateC: input.rateC === null ? null : toFixed2(input.rateC) } : {}),
      },
    });
    await recordRateChanges(tx, input.id, ratesOf(current), ratesOf(updated), session.userId, input.reason);
    return updated;
  });
}

/**
 * Raises or lowers rates by a percentage across all active items, for when the price of wax moves.
 * Only rates that are set are changed (an empty Rate A or C stays "same as Rate B"). Returns what changed.
 */
export async function adjustRates(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(
    z.object({
      percent: z.union([z.string(), z.number()]).transform((v) => String(v).trim().replace(/,/g, ""))
        .refine((v) => /^-?\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) !== 0 && Number(v) >= -90 && Number(v) <= 300, "Enter a percentage between -90 and 300, not zero (for example 5 or -3)."),
      tiers: z.array(z.enum(RATE_TIERS)).min(1, "Choose at least one rate (A, B or C).").max(3),
      reason: z.string().trim().max(200).optional(),
    }),
    rawInput
  );
  const factor = D(100).plus(D(input.percent)).div(100);
  const tiers = new Set<RateTier>(input.tiers);
  // A rate that is not set (or is zero) is left alone.
  const bump = (rate: string | null) => (rate === null || D(rate).lessThanOrEqualTo(ZERO) ? rate : round2(D(rate).times(factor)).toFixed(2));
  return prisma.$transaction(async (tx) => {
    const items = await tx.product.findMany({ where: { isActive: true } });
    let changedItems = 0;
    for (const item of items) {
      const before = ratesOf(item);
      const after: RateSet = { A: tiers.has("A") ? bump(before.A) : before.A, B: tiers.has("B") ? bump(before.B) : before.B, C: tiers.has("C") ? bump(before.C) : before.C };
      if (RATE_TIERS.every((t) => sameRate(before[t], after[t]))) continue;
      await tx.product.update({ where: { id: item.id }, data: { unitPrice: after.B ?? before.B ?? "0", rateA: after.A, rateC: after.C } });
      await recordRateChanges(tx, item.id, before, after, session.userId, input.reason ?? `All rates ${Number(input.percent) > 0 ? "up" : "down"} ${Math.abs(Number(input.percent))}%`);
      changedItems += 1;
    }
    return { changedItems, percent: input.percent };
  });
}

/**
 * Sets the same GST rate on every active item at once (for example 5%). Only new bills use it; bills already made keep
 * the rate they were printed with. Returns how many items changed.
 */
export async function setAllGstRate(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { gstRate: rate } = parseInput(z.object({ gstRate }), rawInput);
  const result = await prisma.product.updateMany({ where: { isActive: true, NOT: { gstRate: toFixed2(rate) } }, data: { gstRate: toFixed2(rate) } });
  return { changed: result.count, gstRate: toFixed2(rate) };
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
