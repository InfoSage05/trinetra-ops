import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError } from "@/lib/errors";
import { entityId, parseInput } from "@/lib/validation";
import { formatDocumentNumber } from "@/domain/numbering";

/**
 * Throws away a bill that was only made for testing, as if it had never been made: its lines, payments, returns and the
 * stock it took all disappear, so it never shows in reports. A note of the deletion is kept for good.
 *
 * Real invoices must NOT be deleted: they are legal records and are corrected with a credit note. So this is refused
 * for any bill that already has an e-invoice number (IRN), and it must be confirmed as "only a test".
 *
 * Numbers: the next invoice number becomes (highest remaining number + 1). Deleting the latest bill therefore frees its
 * number for the next bill. Deleting a bill from the middle leaves a gap, because reusing it would repeat a number that a
 * later bill already carries.
 */
export async function deleteBill(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(
    z.object({ billId: entityId, onlyATest: z.literal(true, { error: "Tick the box to confirm this bill was only a test." }) }),
    rawInput
  );

  return prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findUnique({
      where: { id: input.billId },
      include: { lineItems: true, payments: true, creditNotes: { include: { lines: true, irpSubmission: true } }, irpSubmission: true },
    });
    if (!bill) throw new NotFoundError("Bill");
    const issued = bill.irpSubmission?.status === "ACCEPTED" || bill.creditNotes.some((n) => n.irpSubmission?.status === "ACCEPTED");
    if (issued) {
      throw new DomainError("IRN_ISSUED", `${bill.invoiceNumber} already has an e-invoice number, so it is an official record and cannot be deleted. Correct it with a return (credit note) instead.`);
    }

    // Only inside this transaction may the guarded tables allow a delete.
    await tx.$executeRaw`SELECT set_config('app.discarding', 'on', true)`;

    const references = [
      ...bill.lineItems.map((l) => `bill_line:${l.id}`),
      ...bill.creditNotes.flatMap((n) => n.lines.map((l) => `credit_note_line:${l.id}`)),
    ];
    await tx.stockLedgerEntry.deleteMany({ where: { sourceReference: { in: references } } });
    await tx.irpSubmission.deleteMany({ where: { OR: [{ billId: bill.id }, { creditNoteId: { in: bill.creditNotes.map((n) => n.id) } }] } });
    await tx.creditNoteLine.deleteMany({ where: { creditNoteId: { in: bill.creditNotes.map((n) => n.id) } } });
    await tx.creditNote.deleteMany({ where: { billId: bill.id } });
    await tx.paymentLogEntry.deleteMany({ where: { billId: bill.id } });
    await tx.billCharge.deleteMany({ where: { billId: bill.id } });
    await tx.billLineItem.deleteMany({ where: { billId: bill.id } });
    await tx.bill.delete({ where: { id: bill.id } });

    // Next numbers: one more than the highest that is left in that financial year (or 1 if nothing is left).
    const resetSeries = async (series: "INVOICE" | "CREDIT_NOTE", numbers: string[]) => {
      const rows = await tx.$queryRaw<{ prefix: string }[]>`SELECT "prefix" FROM "number_series" WHERE "series" = ${series} AND "financialYear" = ${bill.financialYear} FOR UPDATE`;
      if (rows.length === 0) return;
      const highest = Math.max(0, ...numbers.map((n) => Number(/(\d+)$/.exec(n)?.[1] ?? 0)));
      await tx.$executeRaw`UPDATE "number_series" SET "nextSerial" = ${highest + 1} WHERE "series" = ${series} AND "financialYear" = ${bill.financialYear}`;
      return { prefix: rows[0].prefix, next: highest + 1 };
    };
    const remainingBills = await tx.bill.findMany({ where: { financialYear: bill.financialYear }, select: { invoiceNumber: true } });
    const invoiceSeries = await resetSeries("INVOICE", remainingBills.map((b) => b.invoiceNumber));
    if (bill.creditNotes.length > 0) {
      const remainingNotes = await tx.creditNote.findMany({ where: { financialYear: bill.financialYear }, select: { creditNoteNumber: true } });
      await resetSeries("CREDIT_NOTE", remainingNotes.map((n) => n.creditNoteNumber));
    }

    await tx.billDeletion.create({
      data: {
        invoiceNumber: bill.invoiceNumber, billDate: bill.billDate, customerName: bill.customerName, grandTotal: bill.grandTotal,
        hadPayments: bill.payments.length > 0, hadReturns: bill.creditNotes.length > 0, deletedBy: session.userId,
      },
    });

    return {
      invoiceNumber: bill.invoiceNumber,
      nextInvoiceNumber: invoiceSeries ? formatDocumentNumber(invoiceSeries.prefix, bill.financialYear, invoiceSeries.next) : null,
    };
  });
}
