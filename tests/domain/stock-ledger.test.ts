import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { getCurrentStock, getStockLevels, writeLedgerEntry } from "@/domain/stock";
import { DomainError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeProduct } from "../helpers/factories";

describe("stock ledger core", () => {
  beforeEach(resetDb);

  it("computes stock as the sum of entries, and 0 for products with none", async () => {
    const a = await makeProduct();
    const b = await makeProduct();
    await writeLedgerEntry(prisma, { productId: a.id, quantityDelta: "100", type: "OPENING", createdBy: "u", idempotencyKey: "k-open-a" });
    await writeLedgerEntry(prisma, { productId: a.id, quantityDelta: "-30", type: "BILLED", createdBy: "u", idempotencyKey: "k-bill-a" });

    const levels = await getStockLevels(prisma, [a.id, b.id]);
    expect(levels.get(a.id)?.toFixed(2)).toBe("70.00");
    expect(levels.get(b.id)?.toFixed(2)).toBe("0.00");
    expect((await getCurrentStock(prisma, a.id)).toFixed(2)).toBe("70.00");
  });

  it("returns the original row when the same idempotency key is replayed", async () => {
    const p = await makeProduct();
    const input = { productId: p.id, quantityDelta: "50", type: "PRODUCED" as const, createdBy: "u", idempotencyKey: "k-replay" };
    const first = await writeLedgerEntry(prisma, input);
    const second = await writeLedgerEntry(prisma, input);
    expect(second.id).toBe(first.id);
    expect((await getCurrentStock(prisma, p.id)).toFixed(2)).toBe("50.00");
  });

  it("is safe when identical writes race each other", async () => {
    const p = await makeProduct();
    const input = { productId: p.id, quantityDelta: "5", type: "PRODUCED" as const, createdBy: "u", idempotencyKey: "k-race" };
    await Promise.all(Array.from({ length: 5 }, () => prisma.$transaction((tx) => writeLedgerEntry(tx, input))));
    expect(await prisma.stockLedgerEntry.count({ where: { productId: p.id } })).toBe(1);
  });

  it("refuses to reuse a key for a different change", async () => {
    const p = await makeProduct();
    await writeLedgerEntry(prisma, { productId: p.id, quantityDelta: "5", type: "PRODUCED", createdBy: "u", idempotencyKey: "k-conflict" });
    await expect(
      writeLedgerEntry(prisma, { productId: p.id, quantityDelta: "9", type: "PRODUCED", createdBy: "u", idempotencyKey: "k-conflict" })
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("enforces sign rules and adjustment reasons", async () => {
    const p = await makeProduct();
    const base = { productId: p.id, createdBy: "u" };
    await expect(writeLedgerEntry(prisma, { ...base, quantityDelta: "-5", type: "PRODUCED", idempotencyKey: "k-s1" })).rejects.toThrow(ValidationError);
    await expect(writeLedgerEntry(prisma, { ...base, quantityDelta: "5", type: "BILLED", idempotencyKey: "k-s2" })).rejects.toThrow(ValidationError);
    await expect(writeLedgerEntry(prisma, { ...base, quantityDelta: "-2", type: "ADJUSTMENT", idempotencyKey: "k-s3" })).rejects.toThrow(/reason/i);
    await expect(writeLedgerEntry(prisma, { ...base, quantityDelta: "0", type: "ADJUSTMENT", reason: "x", idempotencyKey: "k-s4" })).rejects.toThrow(DomainError);
  });
});
