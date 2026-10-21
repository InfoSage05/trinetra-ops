import Decimal from "decimal.js";
import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import type { Prisma, StockLedgerEntry } from "@/generated/prisma/client";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { D, ZERO, toFixed2, type DecimalInput } from "@/lib/money";
import { entityId, idempotencyKey, nonNegativeQuantity, optionalText, parseInput, quantity, requiredText, signedQuantity } from "@/lib/validation";

export type LedgerType = "OPENING" | "PRODUCED" | "BILLED" | "RETURN" | "ADJUSTMENT";

export type LedgerWrite = {
  productId: string;
  quantityDelta: DecimalInput;
  type: LedgerType;
  reason?: string;
  sourceReference?: string;
  createdBy: string;
  idempotencyKey: string;
  actorType?: "HUMAN" | "AGENT";
  sourceMetadata?: Prisma.InputJsonValue;
};

const SIGN_RULE: Record<LedgerType, "positive" | "negative" | "nonzero"> = {
  OPENING: "positive",
  PRODUCED: "positive",
  RETURN: "positive",
  BILLED: "negative",
  ADJUSTMENT: "nonzero",
};

export async function getStockLevels(db: Db, productIds?: string[]): Promise<Map<string, Decimal>> {
  const rows = await db.stockLedgerEntry.groupBy({
    by: ["productId"],
    where: productIds ? { productId: { in: productIds } } : undefined,
    _sum: { quantityDelta: true },
  });
  const levels = new Map<string, Decimal>();
  for (const id of productIds ?? []) levels.set(id, ZERO);
  for (const row of rows) levels.set(row.productId, D(row._sum.quantityDelta ?? 0));
  return levels;
}

export async function getCurrentStock(db: Db, productId: string): Promise<Decimal> {
  return (await getStockLevels(db, [productId])).get(productId) ?? ZERO;
}

/**
 * The single writer of stock_ledger. Idempotent: replaying a key returns the original row.
 * Uses ON CONFLICT DO NOTHING (createMany + skipDuplicates) so a duplicate never aborts the
 * caller's transaction, which a caught unique-violation would.
 */
export async function writeLedgerEntry(db: Db, input: LedgerWrite): Promise<StockLedgerEntry> {
  const delta = D(input.quantityDelta);
  const rule = SIGN_RULE[input.type];
  if (delta.isZero()) throw new DomainError("ZERO_QUANTITY", "A stock change cannot be zero.");
  if (rule === "positive" && delta.isNegative()) throw new ValidationError(`${input.type} must increase stock.`);
  if (rule === "negative" && delta.isPositive()) throw new ValidationError(`${input.type} must decrease stock.`);
  if (input.type === "ADJUSTMENT" && !input.reason?.trim()) {
    throw new ValidationError("A reason is required for every stock adjustment.");
  }

  const quantityDelta = toFixed2(delta);
  await db.stockLedgerEntry.createMany({
    data: [{
      productId: input.productId,
      quantityDelta,
      type: input.type,
      reason: input.reason?.trim() || null,
      sourceReference: input.sourceReference ?? null,
      createdBy: input.createdBy,
      idempotencyKey: input.idempotencyKey,
      actorType: input.actorType ?? "HUMAN",
      sourceMetadata: input.sourceMetadata,
    }],
    skipDuplicates: true,
  });

  const entry = await db.stockLedgerEntry.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } });
  if (entry.productId !== input.productId || entry.type !== input.type || !D(entry.quantityDelta).equals(D(quantityDelta))) {
    throw new DomainError("IDEMPOTENCY_CONFLICT", "This request was already processed with different details.");
  }
  return entry;
}

async function requireActiveProduct(db: Db, productId: string) {
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) throw new NotFoundError("Product");
  if (!product.isActive) throw new DomainError("PRODUCT_INACTIVE", `${product.name} is marked inactive.`);
  return product;
}

export const recordProductionSchema = z.object({
  productId: entityId,
  quantity,
  note: optionalText(300),
  idempotencyKey,
});

export async function recordProduction(session: Session | null, rawInput: unknown): Promise<StockLedgerEntry> {
  requireRole(session, ["OWNER", "WORKER"]);
  const input = parseInput(recordProductionSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    await requireActiveProduct(tx, input.productId);
    return writeLedgerEntry(tx, {
      productId: input.productId,
      quantityDelta: input.quantity,
      type: "PRODUCED",
      reason: input.note,
      createdBy: session.userId,
      idempotencyKey: `production:${input.idempotencyKey}`,
    });
  });
}

export const adjustStockSchema = z.object({
  productId: entityId,
  quantityDelta: signedQuantity,
  reason: requiredText("Reason", 300),
  idempotencyKey,
});

export async function adjustStock(session: Session | null, rawInput: unknown): Promise<StockLedgerEntry> {
  requireRole(session, ["OWNER"]);
  const input = parseInput(adjustStockSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    await requireActiveProduct(tx, input.productId);
    return writeLedgerEntry(tx, {
      productId: input.productId,
      quantityDelta: input.quantityDelta,
      type: "ADJUSTMENT",
      reason: input.reason,
      createdBy: session.userId,
      idempotencyKey: `adjustment:${input.idempotencyKey}`,
    });
  });
}

const openingImportSchema = z.object({
  importBatchId: z.string().trim().min(3).max(100),
  rows: z.array(z.object({ rowNumber: z.number().int(), sku: z.string().optional(), name: z.string().optional(), quantity: z.string().optional() })).max(2000),
});

export type OpeningPreview = {
  ready: { rowNumber: number; productId: string; sku: string; name: string; quantity: string }[];
  problems: { rowNumber: number; sku: string; message: string }[];
};

const openingKey = (batch: string, productId: string) => `opening:${batch}:${productId}`;

async function buildOpeningPreview(db: Db, input: z.output<typeof openingImportSchema>): Promise<OpeningPreview> {
  const skus = input.rows.map((r) => (r.sku ?? "").trim().toUpperCase()).filter(Boolean);
  const products = await db.product.findMany({ where: { OR: [{ sku: { in: skus } }, { isActive: true }] } });
  const bySku = new Map(products.flatMap((p) => (p.sku ? [[p.sku, p] as const] : [])));
  const byName = new Map(products.filter((p) => p.isActive).map((p) => [p.name.replace(/\s+/g, " ").toLowerCase(), p]));
  const priorOpenings = await db.stockLedgerEntry.findMany({
    where: { type: "OPENING", productId: { in: products.map((p) => p.id) } },
    select: { productId: true, idempotencyKey: true },
  });

  const ready: OpeningPreview["ready"] = [];
  const problems: OpeningPreview["problems"] = [];
  const seen = new Set<string>();

  for (const row of input.rows) {
    const code = (row.sku ?? "").trim().toUpperCase();
    const typedName = (row.name ?? "").replace(/\s+/g, " ").trim();
    // An item is found by its code when the sheet gives one, otherwise by its name.
    const product = code ? bySku.get(code) : typedName ? byName.get(typedName.toLowerCase()) : undefined;
    const label = code || typedName;
    const qty = nonNegativeQuantity.safeParse(row.quantity ?? "");
    const fail = (message: string) => problems.push({ rowNumber: row.rowNumber, sku: label, message });

    if (!label) fail("Item code or name is missing");
    else if (product && seen.has(product.id)) fail(`${product.name} appears more than once in the file`);
    else if (!product) fail(`No item matches "${label}". Add or import it first.`);
    else if (!product.isActive) fail(`${product.name} is inactive`);
    else if (!qty.success) fail(qty.error.issues[0]?.message ?? "Invalid quantity");
    else if (priorOpenings.some((o) => o.productId === product.id && o.idempotencyKey !== openingKey(input.importBatchId, product.id))) {
      fail(`${product.name} already has opening stock from an earlier import. Use a stock count to correct it.`);
    } else {
      ready.push({ rowNumber: row.rowNumber, productId: product.id, sku: label, name: product.name, quantity: qty.data });
    }
    if (product) seen.add(product.id);
  }
  return { ready, problems };
}

export async function previewOpeningStock(session: Session | null, rawInput: unknown): Promise<OpeningPreview> {
  requireRole(session, ["OWNER"]);
  return buildOpeningPreview(prisma, parseInput(openingImportSchema, rawInput));
}

export async function importOpeningStock(session: Session | null, rawInput: unknown): Promise<{ imported: number }> {
  requireRole(session, ["OWNER"]);
  const input = parseInput(openingImportSchema, rawInput);
  return prisma.$transaction(async (tx) => {
    const preview = await buildOpeningPreview(tx, input);
    if (preview.problems.length > 0) {
      throw new ValidationError(`Fix ${preview.problems.length} problem(s) in the file before importing.`);
    }
    for (const line of preview.ready) {
      if (D(line.quantity).isZero()) continue;
      await writeLedgerEntry(tx, {
        productId: line.productId, quantityDelta: line.quantity, type: "OPENING",
        reason: `Opening stock import ${input.importBatchId}`, createdBy: session.userId,
        idempotencyKey: openingKey(input.importBatchId, line.productId),
      });
    }
    return { imported: preview.ready.length };
  });
}
