import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createBill } from "@/domain/billing";
import { recordPayment } from "@/domain/payments";
import { submitStockCount } from "@/domain/stock-counts";
import { recordProduction } from "@/domain/stock";
import { getOwnerDashboard, getStockOverview, listBills, listPendingStockCounts } from "@/domain/reports";
import { ForbiddenError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { addStock, makeProduct, setupBillingWorld } from "../helpers/factories";

describe("reports", () => {
  beforeEach(resetDb);

  it("flags negative and low stock without exposing prices to workers", async () => {
    const { worker } = await setupBillingWorld(); // main product: 100 in stock
    const low = await makeProduct({ name: "Low Candle", reorderLevel: "20.00" });
    await addStock(low.id, "5.00");
    const neg = await makeProduct({ name: "Oversold Candle" });
    await prisma.stockLedgerEntry.create({ data: { productId: neg.id, quantityDelta: "-3.00", type: "BILLED", createdBy: "x", idempotencyKey: "neg-1" } });

    const overview = await getStockOverview(worker, {});
    expect(overview.find((r) => r.id === low.id)?.status).toBe("LOW");
    expect(overview.find((r) => r.id === neg.id)?.status).toBe("NEGATIVE");
    expect(Object.keys(overview[0])).not.toContain("unitPrice");
  });

  it("summarises today's sales, dues and pending work for the owner only", async () => {
    const { owner, worker, customer, product } = await setupBillingWorld();
    const bill = await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "rep-bill-0001", lines: [{ productId: product.id, quantity: "10" }] });
    await recordPayment(owner, { billId: bill.id, amount: "770", method: "CASH", idempotencyKey: "rep-pay-0001" });
    const count = await submitStockCount(worker, { productId: product.id, countedQuantity: "85" });
    await recordProduction(worker, { productId: product.id, quantity: "5", idempotencyKey: "rep-prod-0001" });

    const dash = await getOwnerDashboard(owner);
    expect(dash.today).toMatchObject({ billCount: 1 });
    expect(dash.today.salesTotal.toFixed(2)).toBe("1770.00");
    expect(dash.totalDue.toFixed(2)).toBe("1000.00");
    expect(dash.topDues[0]).toMatchObject({ customerId: customer.id });

    const pending = await listPendingStockCounts(owner);
    expect(pending[0]).toMatchObject({ id: count.id, productName: product.name, movementsSinceCount: 1 });
    await expect(getOwnerDashboard(worker)).rejects.toThrow(ForbiddenError);
  });

  it("lists bills with payment status and filters by status", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const paid = await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "rep-bill-0002", lines: [{ productId: product.id, quantity: "1" }], initialPayment: { amount: "177", method: "CASH" } });
    await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "rep-bill-0003", lines: [{ productId: product.id, quantity: "1" }] });
    const unpaid = await listBills(owner, { status: "UNPAID" });
    expect(unpaid).toHaveLength(1);
    expect(unpaid[0].id).not.toBe(paid.id);
    expect((await listBills(owner, { search: paid.invoiceNumber }))[0].payment.status).toBe("PAID");
  });
});
