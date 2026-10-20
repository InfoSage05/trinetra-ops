import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createBill } from "@/domain/billing";
import { recordPayment, getPaymentSummary } from "@/domain/payments";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { setupBillingWorld } from "../helpers/factories";

async function billOf1770() {
  const world = await setupBillingWorld();
  const bill = await createBill(world.owner, {
    customerId: world.customer.id, placeOfSupply: "21", idempotencyKey: "pay-bill-0001",
    lines: [{ productId: world.product.id, quantity: "10" }],
  });
  return { ...world, bill };
}
const pay = (amount: string, key: string, method = "CASH") => ({ amount, method, idempotencyKey: key });

describe("payments", () => {
  beforeEach(resetDb);

  it("moves from UNPAID to PARTIAL to PAID across installments", async () => {
    const { owner, bill } = await billOf1770();
    expect(await getPaymentSummary(prisma, bill.id)).toMatchObject({ status: "UNPAID" });

    await recordPayment(owner, { billId: bill.id, ...pay("500", "pay-key-0001") });
    const partial = await getPaymentSummary(prisma, bill.id);
    expect([partial.status, partial.amountDue.toFixed(2)]).toEqual(["PARTIAL", "1270.00"]);

    await recordPayment(owner, { billId: bill.id, ...pay("1270", "pay-key-0002", "UPI") });
    const paid = await getPaymentSummary(prisma, bill.id);
    expect([paid.status, paid.amountDue.toFixed(2)]).toEqual(["PAID", "0.00"]);
  });

  it("refuses overpayment and over-refund, allows a valid refund", async () => {
    const { owner, bill } = await billOf1770();
    await expect(recordPayment(owner, { billId: bill.id, ...pay("1771", "pay-key-0003") })).rejects.toThrow(ValidationError);
    await recordPayment(owner, { billId: bill.id, ...pay("1770", "pay-key-0004") });
    await expect(recordPayment(owner, { billId: bill.id, ...pay("-1771", "pay-key-0005") })).rejects.toThrow(ValidationError);
    await recordPayment(owner, { billId: bill.id, ...pay("-200", "pay-key-0006"), note: "Refund for 1 damaged unit" });
    expect((await getPaymentSummary(prisma, bill.id)).amountPaid.toFixed(2)).toBe("1570.00");
  });

  it("returns the original entry for a replayed key", async () => {
    const { owner, bill } = await billOf1770();
    const a = await recordPayment(owner, { billId: bill.id, ...pay("100", "pay-key-0007") });
    const b = await recordPayment(owner, { billId: bill.id, ...pay("100", "pay-key-0007") });
    expect(b.id).toBe(a.id);
    expect(await prisma.paymentLogEntry.count({ where: { billId: bill.id } })).toBe(1);
  });

  it("is owner-only", async () => {
    const { worker, bill } = await billOf1770();
    await expect(recordPayment(worker, { billId: bill.id, ...pay("100", "pay-key-0008") })).rejects.toThrow(ForbiddenError);
  });
});
