import { describe, it, expect, beforeEach } from "vitest";
import { createBill } from "@/domain/billing";
import { getCustomerDetail, getProductDetail } from "@/domain/reports";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { addStock, makeBusinessProfile, makeCustomer, makeProduct, makeSeries, makeUser } from "../helpers/factories";

beforeEach(resetDb);

async function world() {
  await makeBusinessProfile();
  await makeSeries("INVOICE");
  const owner = await makeUser("OWNER");
  const worker = await makeUser("WORKER");
  const customer = await makeCustomer();
  const candle = await makeProduct({ name: "Birthday Candle", qtyPerCarton: 12, unitPrice: "10.00", reorderLevel: "30" });
  await addStock(candle.id, "100.00");
  await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "dv-bill-0001", lines: [{ productId: candle.id, cartons: "2" }] });
  return { owner, worker, customer, candle };
}

describe("item and customer detail views", () => {
  it("an item shows live stock, its movements and recent sales (owner), and hides money from workers", async () => {
    const { owner, worker, candle } = await world();
    const asOwner = await getProductDetail(owner, candle.id);
    expect(asOwner.stock.toString()).toBe("76"); // 100 - 2 cartons x 12
    expect(asOwner.status).toBe("OK");
    expect(asOwner.movements.map((m) => m.type)).toEqual(["BILLED", "PRODUCED"]);
    expect(asOwner.recentSales).toHaveLength(1);
    expect(asOwner.unitPrice?.toString()).toBe("10");

    const asWorker = await getProductDetail(worker, candle.id);
    expect(asWorker.unitPrice).toBeNull();
    expect(asWorker.recentSales).toEqual([]);
    await expect(getProductDetail(owner, "nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a customer shows their bills and what is still unpaid; workers are refused", async () => {
    const { owner, worker, customer } = await world();
    const detail = await getCustomerDetail(owner, customer.id);
    expect(detail.bills).toHaveLength(1);
    expect(detail.totalDue.toString()).toBe(detail.billedTotal.toString()); // nothing paid yet
    await expect(getCustomerDetail(worker, customer.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
