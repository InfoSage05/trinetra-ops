import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { recordProduction, adjustStock, getCurrentStock } from "@/domain/stock";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeProduct, makeUser } from "../helpers/factories";

describe("recordProduction", () => {
  beforeEach(resetDb);

  it("lets a worker add produced stock", async () => {
    const worker = await makeUser("WORKER");
    const p = await makeProduct();
    await recordProduction(worker, { productId: p.id, quantity: "200", idempotencyKey: "prod-0001" });
    expect((await getCurrentStock(prisma, p.id)).toFixed(2)).toBe("200.00");
  });

  it("rejects zero or negative quantities (production can never reduce stock)", async () => {
    const worker = await makeUser("WORKER");
    const p = await makeProduct();
    await expect(recordProduction(worker, { productId: p.id, quantity: "-5", idempotencyKey: "prod-0002" })).rejects.toThrow(ValidationError);
    await expect(recordProduction(worker, { productId: p.id, quantity: "0", idempotencyKey: "prod-0003" })).rejects.toThrow(ValidationError);
  });

  it("rejects inactive products and logged-out callers", async () => {
    const owner = await makeUser("OWNER");
    const p = await makeProduct({ isActive: false });
    await expect(recordProduction(owner, { productId: p.id, quantity: "5", idempotencyKey: "prod-0004" })).rejects.toMatchObject({ code: "PRODUCT_INACTIVE" });
    await expect(recordProduction(null, { productId: p.id, quantity: "5", idempotencyKey: "prod-0005" })).rejects.toThrow(ForbiddenError);
  });
});

describe("adjustStock", () => {
  beforeEach(resetDb);

  it("lets the owner correct stock with a reason", async () => {
    const owner = await makeUser("OWNER");
    const p = await makeProduct();
    await recordProduction(owner, { productId: p.id, quantity: "50", idempotencyKey: "prod-0006" });
    const entry = await adjustStock(owner, { productId: p.id, quantityDelta: "-3", reason: "Broken in storage", idempotencyKey: "adj-0001" });
    expect(entry.reason).toBe("Broken in storage");
    expect((await getCurrentStock(prisma, p.id)).toFixed(2)).toBe("47.00");
  });

  it("rejects workers even when they call the function directly", async () => {
    const worker = await makeUser("WORKER");
    const p = await makeProduct();
    await expect(
      adjustStock(worker, { productId: p.id, quantityDelta: "-3", reason: "bypassing the UI", idempotencyKey: "adj-0002" })
    ).rejects.toThrow(ForbiddenError);
  });

  it("requires a reason", async () => {
    const owner = await makeUser("OWNER");
    const p = await makeProduct();
    await expect(adjustStock(owner, { productId: p.id, quantityDelta: "-3", reason: "  ", idempotencyKey: "adj-0003" })).rejects.toThrow(ValidationError);
  });
});
