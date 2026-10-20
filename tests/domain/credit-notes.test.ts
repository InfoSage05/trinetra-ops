import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createBill } from "@/domain/billing";
import { recordReturn } from "@/domain/credit-notes";
import { recordPayment, getPaymentSummary } from "@/domain/payments";
import { getCurrentStock } from "@/domain/stock";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { sumDecimals } from "@/lib/money";
import { resetDb } from "../helpers/db";
import { makeBusinessProfile, makeCustomer, setupBillingWorld, ODISHA_CUSTOMER_GSTIN } from "../helpers/factories";

async function world() {
  const w = await setupBillingWorld();
  const bill = await createBill(w.owner, {
    customerId: w.customer.id, placeOfSupply: "21", idempotencyKey: "cn-bill-0001",
    lines: [{ productId: w.product.id, quantity: "10" }],
  });
  return { ...w, bill, lineId: bill.lineItems[0].id };
}

describe("recordReturn", () => {
  beforeEach(resetDb);

  it("issues a numbered credit note with the invoice's tax treatment and restocks", async () => {
    const { owner, bill, lineId, product } = await world();
    const note = await recordReturn(owner, { billId: bill.id, reason: "Customer returned 2", lines: [{ billLineItemId: lineId, quantity: "2" }], idempotencyKey: "cn-key-0001" });
    expect(note.creditNoteNumber).toMatch(/^CN\/\d{4}\/00001$/);
    expect([note.taxableTotal.toString(), note.cgstTotal.toString(), note.grandTotal.toString()]).toEqual(["300", "27", "354"]);
    expect((await getCurrentStock(prisma, product.id)).toFixed(2)).toBe("92.00");
  });

  it("does not restock damaged goods when restock is false", async () => {
    const { owner, bill, lineId, product } = await world();
    await recordReturn(owner, { billId: bill.id, reason: "Broken in transit", restock: false, lines: [{ billLineItemId: lineId, quantity: "2" }], idempotencyKey: "cn-key-0002" });
    expect((await getCurrentStock(prisma, product.id)).toFixed(2)).toBe("90.00");
  });

  it("reduces the customer's balance due", async () => {
    const { owner, bill, lineId } = await world();
    await recordPayment(owner, { billId: bill.id, amount: "500", method: "CASH", idempotencyKey: "cn-pay-0001" });
    await recordReturn(owner, { billId: bill.id, reason: "Returned 2", lines: [{ billLineItemId: lineId, quantity: "2" }], idempotencyKey: "cn-key-0003" });
    const summary = await getPaymentSummary(prisma, bill.id);
    expect([summary.netReceivable.toFixed(2), summary.amountDue.toFixed(2), summary.status]).toEqual(["1416.00", "916.00", "PARTIAL"]);
  });

  it("never returns more than was billed", async () => {
    const { owner, bill, lineId } = await world();
    await recordReturn(owner, { billId: bill.id, reason: "First", lines: [{ billLineItemId: lineId, quantity: "9" }], idempotencyKey: "cn-key-0004" });
    await expect(recordReturn(owner, { billId: bill.id, reason: "Second", lines: [{ billLineItemId: lineId, quantity: "2" }], idempotencyKey: "cn-key-0005" }))
      .rejects.toThrow(/Only 1 /);
  });

  it("credits exactly the invoiced taxable value across several partial returns", async () => {
    // 3 x 10.00 - 0.01 discount = 29.99 taxable; per-unit 9.99666...
    const w = await setupBillingWorld();
    const bill = await createBill(w.owner, {
      customerId: w.customer.id, placeOfSupply: "21", idempotencyKey: "cn-bill-0002",
      lines: [{ productId: w.product.id, quantity: "3", unitPrice: "10", discountAmount: "0.01" }],
    });
    const lineId = bill.lineItems[0].id;
    for (const k of ["a", "b", "c"]) {
      await recordReturn(w.owner, { billId: bill.id, reason: "unit", lines: [{ billLineItemId: lineId, quantity: "1" }], idempotencyKey: `cn-key-round-${k}` });
    }
    const lines = await prisma.creditNoteLine.findMany({ where: { billLineItemId: lineId } });
    expect(sumDecimals(lines.map((l) => l.taxableValue)).toFixed(2)).toBe("29.99");
  });

  it("rejects items from other bills, replays by key, and blocks workers", async () => {
    const { owner, worker, bill, lineId } = await world();
    await expect(recordReturn(owner, { billId: bill.id, reason: "x", lines: [{ billLineItemId: "not-on-bill", quantity: "1" }], idempotencyKey: "cn-key-0006" }))
      .rejects.toThrow(ValidationError);
    const input = { billId: bill.id, reason: "Replay", lines: [{ billLineItemId: lineId, quantity: "1" }], idempotencyKey: "cn-key-0007" };
    const a = await recordReturn(owner, input);
    const b = await recordReturn(owner, input);
    expect(b.id).toBe(a.id);
    await expect(recordReturn(worker, { ...input, idempotencyKey: "cn-key-0008" })).rejects.toThrow(ForbiddenError);
  });

  it("queues an e-invoice credit note for B2B bills when e-invoicing applies", async () => {
    const w = await setupBillingWorld();
    await makeBusinessProfile({ einvoicingApplicable: true });
    const b2b = await makeCustomer({ gstin: ODISHA_CUSTOMER_GSTIN });
    const bill = await createBill(w.owner, { customerId: b2b.id, placeOfSupply: "21", idempotencyKey: "cn-bill-0003", lines: [{ productId: w.product.id, quantity: "2" }] });
    const note = await recordReturn(w.owner, { billId: bill.id, reason: "Return", lines: [{ billLineItemId: bill.lineItems[0].id, quantity: "1" }], idempotencyKey: "cn-key-0009" });
    expect((await prisma.irpSubmission.findUniqueOrThrow({ where: { creditNoteId: note.id } })).documentType).toBe("CREDIT_NOTE");
  });
});
