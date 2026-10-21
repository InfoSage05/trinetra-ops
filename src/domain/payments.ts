import Decimal from "decimal.js";
import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import { Prisma, type PaymentLogEntry } from "@/generated/prisma/client";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { D, ZERO, formatINR, toFixed2 } from "@/lib/money";
import { entityId, idempotencyKey, optionalText, parseInput, signedMoney } from "@/lib/validation";
import { PAYMENT_METHODS } from "@/domain/billing";

export type PaymentStatus = "PAID" | "PARTIAL" | "UNPAID";
export type PaymentSummary = {
  billId: string; grandTotal: Decimal; creditedTotal: Decimal; netReceivable: Decimal;
  amountPaid: Decimal; amountDue: Decimal; status: PaymentStatus;
};

export async function getPaymentSummaries(db: Db, billIds: string[]): Promise<Map<string, PaymentSummary>> {
  if (billIds.length === 0) return new Map();
  const [bills, paid, credited] = await Promise.all([
    db.bill.findMany({ where: { id: { in: billIds } }, select: { id: true, grandTotal: true } }),
    db.paymentLogEntry.groupBy({ by: ["billId"], where: { billId: { in: billIds } }, _sum: { amount: true } }),
    db.creditNote.groupBy({ by: ["billId"], where: { billId: { in: billIds } }, _sum: { grandTotal: true } }),
  ]);
  const paidBy = new Map(paid.map((p) => [p.billId, D(p._sum.amount ?? 0)]));
  const creditedBy = new Map(credited.map((c) => [c.billId, D(c._sum.grandTotal ?? 0)]));

  return new Map(bills.map((b) => {
    const grandTotal = D(b.grandTotal);
    const creditedTotal = creditedBy.get(b.id) ?? ZERO;
    const amountPaid = paidBy.get(b.id) ?? ZERO;
    const netReceivable = Decimal.max(grandTotal.minus(creditedTotal), ZERO);
    const amountDue = netReceivable.minus(amountPaid);
    const status: PaymentStatus = amountDue.lessThanOrEqualTo(0) ? "PAID" : amountPaid.greaterThan(0) ? "PARTIAL" : "UNPAID";
    return [b.id, { billId: b.id, grandTotal, creditedTotal, netReceivable, amountPaid, amountDue, status }];
  }));
}

export type OutstandingBill = {
  billId: string; customerId: string; customerName: string; invoiceNumber: string; billDate: Date; grandTotal: Decimal; amountDue: Decimal;
};

/**
 * Every bill that still has money owing, worked out in one query (no matter how many bills exist).
 * Same rule as getPaymentSummaries: total, less credit notes (never below zero), less payments received.
 */
export async function listOutstandingBills(db: Db, filter: { customerId?: string } = {}): Promise<OutstandingBill[]> {
  const rows = await db.$queryRaw<{ billId: string; customerId: string; customerName: string; invoiceNumber: string; billDate: Date; grandTotal: string; amountDue: string }[]>(Prisma.sql`
    SELECT b.id AS "billId", b."customerId", b."customerName", b."invoiceNumber", b."billDate",
           b."grandTotal"::text AS "grandTotal",
           (GREATEST(b."grandTotal" - COALESCE(cn.total, 0), 0) - COALESCE(p.total, 0))::text AS "amountDue"
    FROM bills b
    LEFT JOIN (SELECT "billId", SUM("grandTotal") AS total FROM credit_notes GROUP BY "billId") cn ON cn."billId" = b.id
    LEFT JOIN (SELECT "billId", SUM(amount) AS total FROM payment_log GROUP BY "billId") p ON p."billId" = b.id
    WHERE GREATEST(b."grandTotal" - COALESCE(cn.total, 0), 0) - COALESCE(p.total, 0) > 0
      ${filter.customerId ? Prisma.sql`AND b."customerId" = ${filter.customerId}` : Prisma.empty}
    ORDER BY b."billDate" ASC`);
  return rows.map((r) => ({ ...r, grandTotal: D(r.grandTotal), amountDue: D(r.amountDue) }));
}

export async function getPaymentSummary(db: Db, billId: string): Promise<PaymentSummary> {
  const summary = (await getPaymentSummaries(db, [billId])).get(billId);
  if (!summary) throw new NotFoundError("Bill");
  return summary;
}

export const recordPaymentSchema = z.object({
  billId: entityId,
  amount: signedMoney,
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(100),
  note: optionalText(300),
  paidAt: z.coerce.date().optional().refine((d) => !d || d.getTime() <= Date.now() + 5 * 60_000, "Payment date cannot be in the future"),
  idempotencyKey,
});

export async function recordPayment(session: Session | null, rawInput: unknown): Promise<PaymentLogEntry> {
  requireRole(session, ["OWNER"]);
  const input = parseInput(recordPaymentSchema, rawInput);
  const key = `payment:${input.idempotencyKey}`;

  return prisma.$transaction(async (tx) => {
    const replay = await tx.paymentLogEntry.findUnique({ where: { idempotencyKey: key } });
    if (replay) {
      if (replay.billId !== input.billId || !D(replay.amount).equals(D(input.amount))) {
        throw new DomainError("IDEMPOTENCY_CONFLICT", "This payment was already recorded with different details.");
      }
      return replay;
    }

    // Serialise payments per bill so balance checks can't race.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "bills" WHERE "id" = ${input.billId} FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError("Bill");

    const summary = await getPaymentSummary(tx, input.billId);
    const amount = D(input.amount);
    if (amount.isPositive() && amount.greaterThan(summary.amountDue)) {
      throw new ValidationError(
        summary.amountDue.lessThanOrEqualTo(0) ? "This bill is already fully paid." : `Amount is more than the balance due (${formatINR(summary.amountDue)}).`
      );
    }
    if (amount.isNegative() && summary.amountPaid.plus(amount).isNegative()) {
      throw new ValidationError(`Refund cannot be more than the amount received (${formatINR(summary.amountPaid)}).`);
    }

    return tx.paymentLogEntry.create({
      data: {
        billId: input.billId, amount: toFixed2(amount), method: input.method,
        reference: input.reference ?? null, note: input.note ?? null, paidAt: input.paidAt ?? new Date(),
        recordedBy: session.userId, idempotencyKey: key,
      },
    });
  });
}
