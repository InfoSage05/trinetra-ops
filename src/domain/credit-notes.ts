import { z } from "zod";
import { prisma } from "@/lib/db";
import type { CreditNote, CreditNoteLine } from "@/generated/prisma/client";
import { requireRole, type Session } from "@/lib/auth";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { D, ZERO, formatQuantity, round2, toFixed2 } from "@/lib/money";
import { financialYearOf } from "@/lib/time";
import { entityId, idempotencyKey, parseInput, quantity, requiredText } from "@/lib/validation";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { computeTotals, isInterState, taxOnTaxableValue } from "@/domain/tax";
import { allocateNumber } from "@/domain/numbering";
import { requireBusinessProfile } from "@/domain/settings";
import { writeLedgerEntry } from "@/domain/stock";

export const recordReturnSchema = z.object({
  billId: entityId,
  reason: requiredText("Reason", 300),
  restock: z.boolean().default(true),
  lines: z
    .array(z.object({ billLineItemId: entityId, quantity }))
    .min(1, "Choose at least one item to return.")
    .max(100)
    .refine((lines) => new Set(lines.map((l) => l.billLineItemId)).size === lines.length, "Each item can appear only once."),
  idempotencyKey,
});

export type CreatedCreditNote = CreditNote & { lines: CreditNoteLine[] };

export async function recordReturn(session: Session | null, rawInput: unknown): Promise<CreatedCreditNote> {
  requireRole(session, ["OWNER"]);
  const input = parseInput(recordReturnSchema, rawInput);
  const key = `credit-note:${input.idempotencyKey}`;

  const existing = await prisma.creditNote.findUnique({ where: { idempotencyKey: key }, include: { lines: true } });
  if (existing) return existing;

  try {
    return await prisma.$transaction(async (tx) => {
      // Serialise returns per bill so "already returned" can't race.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "bills" WHERE "id" = ${input.billId} FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundError("Bill");
      const bill = await tx.bill.findUniqueOrThrow({ where: { id: input.billId }, include: { lineItems: true } });
      const profile = await requireBusinessProfile(tx);

      const previous = await tx.creditNoteLine.groupBy({
        by: ["billLineItemId"],
        where: { billLineItemId: { in: bill.lineItems.map((l) => l.id) } },
        _sum: { quantity: true, taxableValue: true },
      });
      const prev = new Map(previous.map((p) => [p.billLineItemId, { qty: D(p._sum.quantity ?? 0), taxable: D(p._sum.taxableValue ?? 0) }]));
      const interState = isInterState(bill.supplierStateCode, bill.placeOfSupply);

      const lines = input.lines.map((requested) => {
        const original = bill.lineItems.find((l) => l.id === requested.billLineItemId);
        if (!original) throw new ValidationError("That item is not on this bill.");
        const already = prev.get(original.id) ?? { qty: ZERO, taxable: ZERO };
        const returnable = D(original.quantity).minus(already.qty);
        const qty = D(requested.quantity);
        if (qty.greaterThan(returnable)) {
          throw new ValidationError(`Only ${formatQuantity(returnable)} of ${original.productName} can still be returned.`);
        }
        const taxableValue = qty.equals(returnable)
          ? D(original.taxableValue).minus(already.taxable) // last return of this line: exact remainder
          : round2(D(original.taxableValue).div(D(original.quantity)).times(qty));
        const tax = taxOnTaxableValue(taxableValue, original.gstRate, interState);
        return { original, qty, taxableValue, ...tax, lineTotal: taxableValue.plus(tax.cgstAmount).plus(tax.sgstAmount).plus(tax.igstAmount) };
      });

      const totals = computeTotals(lines);
      const financialYear = financialYearOf();
      const creditNoteNumber = await allocateNumber(tx, "CREDIT_NOTE", financialYear);

      const note = await tx.creditNote.create({
        data: {
          creditNoteNumber, financialYear, billId: bill.id, reason: input.reason, restock: input.restock,
          taxableTotal: toFixed2(totals.taxableTotal), cgstTotal: toFixed2(totals.cgstTotal), sgstTotal: toFixed2(totals.sgstTotal),
          igstTotal: toFixed2(totals.igstTotal), taxTotal: toFixed2(totals.taxTotal), roundOff: toFixed2(totals.roundOff),
          grandTotal: toFixed2(totals.grandTotal), createdBy: session.userId, idempotencyKey: key,
          lines: {
            create: lines.map((l) => ({
              billLineItemId: l.original.id, productId: l.original.productId, quantity: toFixed2(l.qty),
              taxableValue: toFixed2(l.taxableValue), cgstAmount: toFixed2(l.cgstAmount), sgstAmount: toFixed2(l.sgstAmount),
              igstAmount: toFixed2(l.igstAmount), lineTotal: toFixed2(l.lineTotal),
            })),
          },
        },
        include: { lines: true },
      });

      if (input.restock) {
        for (const line of note.lines) {
          await writeLedgerEntry(tx, {
            productId: line.productId, quantityDelta: line.quantity, type: "RETURN",
            reason: `Credit note ${creditNoteNumber}`, sourceReference: `credit_note_line:${line.id}`,
            createdBy: session.userId, idempotencyKey: `credit-note-line:${line.id}`,
          });
        }
      }

      if (profile.einvoicingApplicable && bill.customerGstin) {
        await tx.irpSubmission.create({ data: { documentType: "CREDIT_NOTE", creditNoteId: note.id } });
      }
      return note;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const winner = await prisma.creditNote.findUnique({ where: { idempotencyKey: key }, include: { lines: true } });
      if (winner) return winner;
    }
    throw error;
  }
}
