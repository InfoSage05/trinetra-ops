import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { importProducts, mapProductRows, mapOpeningStockRows } from "@/domain/imports";
import { previewOpeningStock, importOpeningStock, getCurrentStock } from "@/domain/stock";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeProduct, makeUser } from "../helpers/factories";

const row = (rowNumber: number, values: Record<string, string>) => ({ rowNumber, values });

describe("product import", () => {
  beforeEach(resetDb);

  it("creates new SKUs and updates existing ones after a clean dry run", async () => {
    const owner = await makeUser("OWNER");
    await makeProduct({ sku: "LJC-01", name: "Old Name" });
    const rows = mapProductRows([
      row(2, { sku: "LJC-01", name: "Lavender Jar", hsn: "3406", gst: "18", price: "150" }),
      row(3, { code: "RJC-01", productname: "Rose Jar", hsncode: "3406", gstrate: "18", rate: "140", uom: "box" }),
    ]);
    const dry = await importProducts(owner, { rows, dryRun: true });
    expect(dry).toMatchObject({ errors: [], toCreate: 1, toUpdate: 1, created: 0, updated: 0 });

    const done = await importProducts(owner, { rows, dryRun: false });
    expect(done).toMatchObject({ errors: [], created: 1, updated: 1 });
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: "RJC-01" } })).unit).toBe("box");
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: "LJC-01" } })).name).toBe("Lavender Jar");
  });

  it("reports row-numbered problems and writes nothing", async () => {
    const owner = await makeUser("OWNER");
    const rows = mapProductRows([
      row(2, { sku: "A1", name: "Ok", hsn: "3406", gst: "18", price: "10" }),
      row(3, { sku: "A1", name: "Duplicate", hsn: "3406", gst: "18", price: "10" }),
      row(4, { sku: "B1", name: "Bad HSN", hsn: "34", gst: "18", price: "10" }),
    ]);
    const result = await importProducts(owner, { rows, dryRun: false });
    expect(result.errors.map((e) => e.rowNumber)).toEqual([3, 4]);
    expect(await prisma.product.count()).toBe(0);
  });
});

describe("opening stock import", () => {
  beforeEach(resetDb);

  it("previews problems: unknown SKU, bad quantity, duplicate SKU", async () => {
    const owner = await makeUser("OWNER");
    await makeProduct({ sku: "LJC-01" });
    const rows = mapOpeningStockRows([
      row(2, { sku: "LJC-01", qty: "120" }),
      row(3, { sku: "NOPE", qty: "5" }),
      row(4, { sku: "LJC-01", qty: "1" }),
      row(5, { sku: "LJC-01", qty: "-1" }),
    ]);
    const preview = await previewOpeningStock(owner, { importBatchId: "cutover-2026-11-01", rows });
    expect(preview.ready).toHaveLength(1);
    expect(preview.problems.map((p) => p.rowNumber)).toEqual([3, 4, 5]);
    await expect(importOpeningStock(owner, { importBatchId: "cutover-2026-11-01", rows })).rejects.toThrow(ValidationError);
  });

  it("imports once; same batch again is a no-op; a different batch for the same product is refused", async () => {
    const owner = await makeUser("OWNER");
    const p = await makeProduct({ sku: "LJC-01" });
    const rows = mapOpeningStockRows([row(2, { sku: "LJC-01", openingstock: "120" })]);

    expect(await importOpeningStock(owner, { importBatchId: "cutover-a", rows })).toEqual({ imported: 1 });
    expect(await importOpeningStock(owner, { importBatchId: "cutover-a", rows })).toEqual({ imported: 1 });
    expect((await getCurrentStock(prisma, p.id)).toFixed(2)).toBe("120.00");

    const preview = await previewOpeningStock(owner, { importBatchId: "cutover-b", rows });
    expect(preview.problems[0].message).toMatch(/already has opening stock/);
  });

  it("is owner-only", async () => {
    const worker = await makeUser("WORKER");
    await expect(previewOpeningStock(worker, { importBatchId: "x-batch", rows: [] })).rejects.toThrow(ForbiddenError);
  });
});
