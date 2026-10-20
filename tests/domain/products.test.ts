import { describe, it, expect, beforeEach } from "vitest";
import { createProduct, updateProduct, setProductActive, listProducts } from "@/domain/products";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

const lavender = { sku: "ljc-01", name: "Lavender Jar Candle", hsnCode: "3406", unitPrice: "150", gstRate: "18", reorderLevel: "20" };

describe("products", () => {
  beforeEach(resetDb);

  it("creates a product with normalised SKU and defaults", async () => {
    const owner = await makeUser("OWNER");
    const p = await createProduct(owner, lavender);
    expect(p.sku).toBe("LJC-01");
    expect(p.unit).toBe("pcs");
    expect(p.unitPrice.toString()).toBe("150");
  });

  it("rejects duplicate SKUs, bad HSN codes, and workers", async () => {
    const owner = await makeUser("OWNER");
    const worker = await makeUser("WORKER");
    await createProduct(owner, lavender);
    await expect(createProduct(owner, lavender)).rejects.toMatchObject({ code: "DUPLICATE_SKU" });
    await expect(createProduct(owner, { ...lavender, sku: "X1", hsnCode: "34060" })).rejects.toThrow(ValidationError);
    await expect(createProduct(worker, { ...lavender, sku: "X2" })).rejects.toThrow(ForbiddenError);
  });

  it("updates, deactivates and searches products", async () => {
    const owner = await makeUser("OWNER");
    const worker = await makeUser("WORKER");
    const p = await createProduct(owner, lavender);
    await createProduct(owner, { ...lavender, sku: "RJC-01", name: "Rose Jar Candle" });
    await updateProduct(owner, { id: p.id, ...lavender, unitPrice: "160" });
    await setProductActive(owner, { id: p.id, isActive: false });

    expect((await listProducts(worker, { search: "jar" })).map((x) => x.name)).toEqual(["Rose Jar Candle"]);
    const all = await listProducts(owner, { search: "jar", includeInactive: true });
    expect(all.find((x) => x.id === p.id)?.unitPrice.toString()).toBe("160");
  });
});
