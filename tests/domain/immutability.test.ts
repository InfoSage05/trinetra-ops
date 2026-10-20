import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "../helpers/db";

describe("ledger immutability", () => {
  beforeEach(resetDb);

  it("rejects UPDATE and DELETE on stock_ledger rows", async () => {
    const product = await prisma.product.create({
      data: { sku: "IMM-1", name: "Test Candle", hsnCode: "3406", unitPrice: "10.00", gstRate: "18.00" },
    });
    const entry = await prisma.stockLedgerEntry.create({
      data: { productId: product.id, quantityDelta: "5.00", type: "PRODUCED", createdBy: "u1", idempotencyKey: "imm-1" },
    });

    await expect(
      prisma.stockLedgerEntry.update({ where: { id: entry.id }, data: { quantityDelta: "500.00" } })
    ).rejects.toThrow(/immutable/);
    await expect(prisma.stockLedgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/immutable/);

    const reread = await prisma.stockLedgerEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(reread.quantityDelta.toString()).toBe("5");
  });

  it("still allows normal updates on mutable tables (products)", async () => {
    const product = await prisma.product.create({
      data: { sku: "IMM-2", name: "Old Name", hsnCode: "3406", unitPrice: "10.00", gstRate: "18.00" },
    });
    const updated = await prisma.product.update({ where: { id: product.id }, data: { name: "New Name" } });
    expect(updated.name).toBe("New Name");
  });
});
