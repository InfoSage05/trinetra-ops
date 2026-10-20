import { z } from "zod";
import { prisma } from "@/lib/db";
import type { StockCount } from "@/generated/prisma/client";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError } from "@/lib/errors";
import { D, formatQuantity, toFixed2 } from "@/lib/money";
import { entityId, nonNegativeQuantity, optionalText, parseInput } from "@/lib/validation";
import { getCurrentStock, writeLedgerEntry } from "@/domain/stock";

const ALREADY_RESOLVED = () => new DomainError("ALREADY_RESOLVED", "This count has already been approved or discarded.");

export async function submitStockCount(session: Session | null, rawInput: unknown): Promise<StockCount> {
  requireRole(session, ["OWNER", "WORKER"]);
  const input = parseInput(z.object({ productId: entityId, countedQuantity: nonNegativeQuantity, note: optionalText(300) }), rawInput);
  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new NotFoundError("Product");
  // A second pending count would be applied on top of the first (double-tap or two people counting).
  const alreadyWaiting = await prisma.stockCount.findFirst({ where: { productId: product.id, approvedAt: null, discardedAt: null } });
  if (alreadyWaiting) {
    throw new DomainError("PENDING_COUNT_EXISTS", `A count for ${product.name} is already waiting for approval. The owner should approve or discard it first.`);
  }
  const expected = await getCurrentStock(prisma, product.id);
  return prisma.stockCount.create({
    data: {
      productId: product.id, countedQuantity: toFixed2(input.countedQuantity), expectedQuantity: toFixed2(expected),
      note: input.note ?? null, countedBy: session.userId,
    },
  });
}

export async function approveStockCount(session: Session | null, rawInput: unknown): Promise<StockCount> {
  requireRole(session, ["OWNER"]);
  const { stockCountId } = parseInput(z.object({ stockCountId: entityId }), rawInput);
  return prisma.$transaction(async (tx) => {
    // Claim the count atomically; a concurrent second approval re-checks this WHERE after the first commits.
    const claimed = await tx.stockCount.updateMany({
      where: { id: stockCountId, approvedAt: null, discardedAt: null },
      data: { approvedBy: session.userId, approvedAt: new Date() },
    });
    if (claimed.count === 0) {
      if (!(await tx.stockCount.findUnique({ where: { id: stockCountId } }))) throw new NotFoundError("Stock count");
      throw ALREADY_RESOLVED();
    }
    const count = await tx.stockCount.findUniqueOrThrow({ where: { id: stockCountId } });
    const delta = D(count.countedQuantity).minus(D(count.expectedQuantity)); // discrepancy found at count time
    if (!delta.isZero()) {
      await writeLedgerEntry(tx, {
        productId: count.productId, quantityDelta: delta, type: "ADJUSTMENT",
        reason: `Physical count: counted ${formatQuantity(count.countedQuantity)}, system showed ${formatQuantity(count.expectedQuantity)}`,
        sourceReference: `stock_count:${count.id}`, createdBy: session.userId, idempotencyKey: `stock-count:${count.id}`,
      });
    }
    return tx.stockCount.update({ where: { id: count.id }, data: { appliedDelta: toFixed2(delta) } });
  });
}

export async function discardStockCount(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { stockCountId } = parseInput(z.object({ stockCountId: entityId }), rawInput);
  const result = await prisma.stockCount.updateMany({
    where: { id: stockCountId, approvedAt: null, discardedAt: null },
    data: { discardedBy: session.userId, discardedAt: new Date() },
  });
  if (result.count === 0) throw ALREADY_RESOLVED();
  return { discarded: true };
}
