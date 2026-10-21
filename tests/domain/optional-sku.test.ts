import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct, renameProduct, setCartonSize, updateProduct } from "@/domain/products";
import { importProducts } from "@/domain/imports";
import { importOpeningStock, previewOpeningStock, getCurrentStock } from "@/domain/stock";
import { createBill } from "@/domain/billing";
import { getInvoiceView } from "@/domain/invoice-view";
import { DomainError, ForbiddenError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeBusinessProfile, makeCustomer, makeSeries, makeUser } from "../helpers/factories";

beforeEach(resetDb);

const base = { hsnCode: "3406", unitPrice: "10", gstRate: "18" };

describe("items without a code", () => {
  it("can be created without a code, any number of times, and are told apart by name", async () => {
    const owner = await makeUser("OWNER");
    const a = await createProduct(owner, { ...base, name: "3 x 14 COLOUR" });
    const b = await createProduct(owner, { ...base, name: "4 x 14 COLOUR", sku: "" });
    expect(a.sku).toBeNull();
    expect(b.sku).toBeNull();
    await expect(createProduct(owner, { ...base, name: "  3   x 14  colour " })).rejects.toMatchObject({ code: "DUPLICATE_NAME" });
    const withCode = await createProduct(owner, { ...base, name: "Masjid", sku: "m-1" });
    expect(withCode.sku).toBe("M-1");
    await expect(createProduct(owner, { ...base, name: "Masjid 2", sku: "M-1" })).rejects.toMatchObject({ code: "DUPLICATE_SKU" });
  });

  it("can be renamed; the new name must be free, and old bills keep the name they were printed with", async () => {
    await makeBusinessProfile();
    await makeSeries("INVOICE");
    const owner = await makeUser("OWNER");
    const worker = await makeUser("WORKER");
    const customer = await makeCustomer();
    const item = await createProduct(owner, { ...base, name: "Rose" });
    await createProduct(owner, { ...base, name: "Jasmine" });
    const bill = await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "rn-bill-0001", confirmShortfall: true, lines: [{ productId: item.id, quantity: "2" }] });

    const renamed = await renameProduct(owner, { id: item.id, name: "Rose small pack" });
    expect(renamed.name).toBe("Rose small pack");
    await expect(renameProduct(owner, { id: item.id, name: "jasmine" })).rejects.toBeInstanceOf(DomainError);
    await expect(renameProduct(worker, { id: item.id, name: "Anything" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateProduct(owner, { id: item.id, ...base, name: "Jasmine" })).rejects.toMatchObject({ code: "DUPLICATE_NAME" });

    const view = await getInvoiceView(owner, bill.id);
    expect(view.lines[0].productName).toBe("Rose");
  });

  it("are matched by name when an Excel sheet has no code column, without making duplicates", async () => {
    const owner = await makeUser("OWNER");
    const first = await importProducts(owner, { dryRun: false, rows: [{ rowNumber: 2, name: "Tapper Spiral No-1", hsnCode: "3406", unitPrice: "5", gstRate: "18" }] });
    expect(first).toMatchObject({ created: 1, updated: 0 });
    const again = await importProducts(owner, { dryRun: false, rows: [{ rowNumber: 2, name: "TAPPER  spiral no-1", hsnCode: "3406", unitPrice: "7", gstRate: "18" }] });
    expect(again).toMatchObject({ created: 0, updated: 1 });
    const all = await prisma.product.findMany();
    expect(all).toHaveLength(1);
    expect(all[0].unitPrice.toString()).toBe("7");
    expect(all[0].sku).toBeNull();
  });

  it("can be given opening stock by name", async () => {
    const owner = await makeUser("OWNER");
    const item = await createProduct(owner, { ...base, name: "Birthday 8" });
    const rows = [{ rowNumber: 2, name: "birthday  8", quantity: "30" }, { rowNumber: 3, name: "Nothing like this", quantity: "1" }];
    const preview = await previewOpeningStock(owner, { importBatchId: "batch-1", rows });
    expect(preview.ready).toHaveLength(1);
    expect(preview.problems[0].message).toContain("No item matches");
    await importOpeningStock(owner, { importBatchId: "batch-2", rows: [rows[0]] });
    expect((await getCurrentStock(prisma, item.id)).toString()).toBe("30");
  });

  it("carton size can be set on its own, must be a whole number of 1 or more, and only by the owner", async () => {
    const owner = await makeUser("OWNER");
    const worker = await makeUser("WORKER");
    const item = await createProduct(owner, { ...base, name: "Flower box" });
    expect((await setCartonSize(owner, { id: item.id, qtyPerCarton: "24" })).qtyPerCarton).toBe(24);
    for (const bad of ["0", "-2", "1.5", "abc", ""]) await expect(setCartonSize(owner, { id: item.id, qtyPerCarton: bad })).rejects.toThrow();
    await expect(setCartonSize(worker, { id: item.id, qtyPerCarton: "5" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: item.id } })).qtyPerCarton).toBe(24);
  });
});
