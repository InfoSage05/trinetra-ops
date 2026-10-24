import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createBill } from "@/domain/billing";
import { deleteBill } from "@/domain/bill-deletion";
import { recordPayment } from "@/domain/payments";
import { recordReturn } from "@/domain/credit-notes";
import { getCurrentStock } from "@/domain/stock";
import { getOwnerDashboard, listBills } from "@/domain/reports";
import { getSalesReport } from "@/domain/sales-reports";
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { istToday } from "@/lib/time";
import { resetDb } from "../helpers/db";
import { addStock, makeBusinessProfile, makeCustomer, makeProduct, makeSeries, makeUser } from "../helpers/factories";

beforeEach(resetDb);

async function world() {
  await makeBusinessProfile();
  await makeSeries("INVOICE");
  await makeSeries("CREDIT_NOTE");
  const owner = await makeUser("OWNER");
  const worker = await makeUser("WORKER");
  const customer = await makeCustomer();
  const item = await makeProduct({ name: "Test candle", unitPrice: "100.00", gstRate: "5.00" });
  await addStock(item.id, "100.00");
  const bill = (key: string, qty = "10") =>
    createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: key, lines: [{ productId: item.id, quantity: qty }] });
  return { owner, worker, customer, item, bill };
}

describe("deleting a test bill", () => {
  it("frees the number when the latest bill is deleted, and the next bill takes it", async () => {
    const { owner, bill } = await world();
    await bill("del-bill-0001");
    await bill("del-bill-0002");
    const third = await bill("del-bill-0003");
    expect(third.invoiceNumber).toMatch(/00003$/);

    const done = await deleteBill(owner, { billId: third.id, onlyATest: true });
    expect(done.invoiceNumber).toBe(third.invoiceNumber);
    expect(done.nextInvoiceNumber).toBe(third.invoiceNumber);
    const again = await bill("del-bill-0004");
    expect(again.invoiceNumber).toBe(third.invoiceNumber); // 3 again, not 4
  });

  it("deleting several latest bills one after another frees all their numbers; a middle bill leaves a gap", async () => {
    const { owner, bill } = await world();
    const a = await bill("mid-bill-0001");
    const b = await bill("mid-bill-0002");
    const c = await bill("mid-bill-0003");
    await deleteBill(owner, { billId: b.id, onlyATest: true }); // the middle one: 3 stays taken
    expect((await bill("mid-bill-0004")).invoiceNumber).toMatch(/00004$/);
    const latest = await prisma.bill.findFirstOrThrow({ orderBy: { invoiceNumber: "desc" } });
    await deleteBill(owner, { billId: latest.id, onlyATest: true });
    await deleteBill(owner, { billId: c.id, onlyATest: true });
    expect((await bill("mid-bill-0005")).invoiceNumber).toBe(b.invoiceNumber); // only bill 1 is left, so the next one is 2
    void a;
  });

  it("puts the stock back and removes payments, returns and the bill from the lists and reports", async () => {
    const { owner, item, bill } = await world();
    const kept = await bill("rep-bill-0001", "5");
    const test = await bill("rep-bill-0002", "10");
    await recordPayment(owner, { billId: test.id, amount: "100", method: "CASH", idempotencyKey: "rep-pay-0001" });
    await recordReturn(owner, { billId: test.id, reason: "x", lines: [{ billLineItemId: test.lineItems[0].id, quantity: "2" }], idempotencyKey: "rep-cn-0001" });
    expect((await getCurrentStock(prisma, item.id)).toString()).toBe("87"); // 100 - 5 - 10 + 2 returned

    await deleteBill(owner, { billId: test.id, onlyATest: true });
    expect((await getCurrentStock(prisma, item.id)).toString()).toBe("95"); // only the kept bill remains
    expect(await prisma.paymentLogEntry.count()).toBe(0);
    expect(await prisma.creditNote.count()).toBe(0);
    expect((await listBills(owner, {})).map((b) => b.id)).toEqual([kept.id]);

    const range = { from: istToday(), to: istToday() };
    expect((await getSalesReport(owner, range)).billCount).toBe(1);
    expect((await getOwnerDashboard(owner)).totalDue.toString()).toBe(kept.grandTotal.toString());

    // A note of the deletion is kept for good.
    const note = await prisma.billDeletion.findFirstOrThrow();
    expect(note).toMatchObject({ invoiceNumber: test.invoiceNumber, hadPayments: true, hadReturns: true });
    await expect(prisma.billDeletion.deleteMany({})).rejects.toThrow();
    await expect(prisma.billDeletion.updateMany({ data: { customerName: "x" } })).rejects.toThrow();
  });

  it("must be confirmed as a test, is for the owner only, and cannot touch a bill with an e-invoice number", async () => {
    const { owner, worker, bill } = await world();
    const b = await bill("rule-bill-0001");
    await expect(deleteBill(owner, { billId: b.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(deleteBill(owner, { billId: b.id, onlyATest: false })).rejects.toBeInstanceOf(ValidationError);
    await expect(deleteBill(worker, { billId: b.id, onlyATest: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteBill(owner, { billId: "nope", onlyATest: true })).rejects.toBeInstanceOf(NotFoundError);

    await prisma.irpSubmission.upsert({ where: { billId: b.id }, update: { status: "ACCEPTED", irn: "IRN123" }, create: { documentType: "INVOICE", billId: b.id, status: "ACCEPTED", irn: "IRN123" } });
    await expect(deleteBill(owner, { billId: b.id, onlyATest: true })).rejects.toMatchObject({ code: "IRN_ISSUED" });
    expect(await prisma.bill.count()).toBe(1);
    void DomainError;
  });

  it("the guarded tables still refuse a delete made any other way", async () => {
    const { bill } = await world();
    const b = await bill("guard-bill-0001");
    await expect(prisma.bill.delete({ where: { id: b.id } })).rejects.toThrow();
    await expect(prisma.stockLedgerEntry.deleteMany({})).rejects.toThrow();
  });
});
