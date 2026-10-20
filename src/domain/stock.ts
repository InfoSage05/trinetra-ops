import Decimal from "decimal.js";
import type { Db } from "@/lib/db";
import type { Prisma, StockLedgerEntry } from "@/generated/prisma/client";
import { DomainError, ValidationError } from "@/lib/errors";
import { D, ZERO, toFixed2, type DecimalInput } from "@/lib/money";

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
