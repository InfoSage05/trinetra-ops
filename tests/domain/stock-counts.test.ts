import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { submitStockCount, approveStockCount, discardStockCount } from "@/domain/stock-counts";
import { getCurrentStock, recordProduction } from "@/domain/stock";
import { ForbiddenError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { addStock, makeProduct, makeUser } from "../helpers/factories";

const stock = async (id: string) => (await getCurrentStock(prisma, id)).toFixed(2);

describe("stock counts", () => {
  beforeEach(resetDb);

  it("a submitted count changes nothing until approved, then applies the discrepancy once", async () => {
    const owner = await makeUser("OWNER");
    const worker = await makeUser("WORKER");
    const p = await makeProduct();
    await addStock(p.id, "50.00");

    const count = await submitStockCount(worker, { productId: p.id, countedQuantity: "48" });
    expect(count.expectedQuantity.toString()).toBe("50");
    expect(await stock(p.id)).toBe("50.00");

    const approved = await approveStockCount(owner, { stockCountId: count.id });
    expect(approved.appliedDelta?.toString()).toBe("-2");
    expect(await stock(p.id)).toBe("48.00");
    expect(await prisma.stockLedgerEntry.count({ where: { productId: p.id, type: "ADJUSTMENT" } })).toBe(1);
  });

  it("keeps production recorded between the count and the approval", async () => {
    const owner = await makeUser("OWNER");
    const p = await makeProduct();
    await addStock(p.id, "50.00");
    const count = await submitStockCount(owner, { productId: p.id, countedQuantity: "48" }); // 2 missing
    await recordProduction(owner, { productId: p.id, quantity: "10", idempotencyKey: "count-prod-0001" });
    await approveStockCount(owner, { stockCountId: count.id });
    expect(await stock(p.id)).toBe("58.00");
  });

  it("cannot be approved twice, even concurrently, and discarded counts change nothing", async () => {
    const owner = await makeUser("OWNER");
    const p = await makeProduct();
    await addStock(p.id, "50.00");
    const count = await submitStockCount(owner, { productId: p.id, countedQuantity: "45" });
    const results = await Promise.allSettled([
      approveStockCount(owner, { stockCountId: count.id }),
      approveStockCount(owner, { stockCountId: count.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await stock(p.id)).toBe("45.00");

    const other = await submitStockCount(owner, { productId: p.id, countedQuantity: "1" });
    await discardStockCount(owner, { stockCountId: other.id });
    await expect(approveStockCount(owner, { stockCountId: other.id })).rejects.toMatchObject({ code: "ALREADY_RESOLVED" });
    expect(await stock(p.id)).toBe("45.00");
  });

  it("only owners approve", async () => {
    const worker = await makeUser("WORKER");
    const p = await makeProduct();
    const count = await submitStockCount(worker, { productId: p.id, countedQuantity: "1" });
    await expect(approveStockCount(worker, { stockCountId: count.id })).rejects.toThrow(ForbiddenError);
  });
});
