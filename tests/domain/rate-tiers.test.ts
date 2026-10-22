import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { adjustRates, createProduct, quickEditProduct, updateProduct } from "@/domain/products";
import { createCustomer } from "@/domain/customers";
import { createBill, previewBill } from "@/domain/billing";
import { importProducts, mapProductRows } from "@/domain/imports";
import { getProductDetail } from "@/domain/reports";
import { getInvoiceView } from "@/domain/invoice-view";
import { rateFor } from "@/lib/rates";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { addStock, makeBusinessProfile, makeCustomer, makeSeries, makeUser } from "../helpers/factories";

beforeEach(resetDb);

const base = { hsnCode: "3406", gstRate: "5" };

async function world() {
  await makeBusinessProfile();
  await makeSeries("INVOICE");
  const owner = await makeUser("OWNER");
  const worker = await makeUser("WORKER");
  const item = await createProduct(owner, { ...base, name: "Birthday 12", unitPrice: "100", rateA: "80", rateC: "130" });
  await addStock(item.id, "500.00");
  return { owner, worker, item };
}

describe("three rates per item", () => {
  it("A is for big wholesalers, B for normal, C for direct vendors; a tier with no rate uses B", async () => {
    const { owner, item } = await world();
    expect(item.rateA?.toString()).toBe("80");
    expect(item.rateC?.toString()).toBe("130");
    expect(rateFor(item, "A").toString()).toBe("80");
    expect(rateFor(item, "B").toString()).toBe("100");
    expect(rateFor(item, "C").toString()).toBe("130");
    const plain = await createProduct(owner, { ...base, name: "Plain", unitPrice: "50", rateA: "", rateC: "" });
    expect(plain.rateA).toBeNull();
    expect(rateFor(plain, "A").toString()).toBe("50");
    expect(rateFor(plain, "C").toString()).toBe("50");
  });

  it("a bill uses the customer's rate type, the bill can override it, and a typed rate beats both", async () => {
    const { owner, item } = await world();
    const big = await createCustomer(owner, { name: "Big Wholesaler", billingAddress: "x", stateCode: "21", rateTier: "A" });
    const plain = await makeCustomer({ name: "Normal" });
    const lineOf = (customerId: string, extra: object = {}, line: object = {}) =>
      previewBill(owner, { customerId, placeOfSupply: "21", lines: [{ productId: item.id, quantity: "10", ...line }], ...extra });

    expect((await lineOf(big.id)).lines[0].unitPrice.toString()).toBe("80");
    expect((await lineOf(plain.id)).lines[0].unitPrice.toString()).toBe("100"); // customers default to B
    expect((await lineOf(plain.id, { rateTier: "C" })).lines[0].unitPrice.toString()).toBe("130");
    expect((await lineOf(big.id, { rateTier: "C" }, { unitPrice: "111" })).lines[0].unitPrice.toString()).toBe("111");
    expect((await lineOf(big.id)).rateTier).toBe("A");

    const bill = await createBill(owner, { customerId: plain.id, placeOfSupply: "21", rateTier: "C", idempotencyKey: "tier-bill-0001", lines: [{ productId: item.id, quantity: "10" }] });
    expect(bill.rateTier).toBe("C");
    expect(bill.lineItems[0].unitPrice.toString()).toBe("130");
    // Changing the rates later never touches the printed bill.
    await quickEditProduct(owner, { id: item.id, rateC: "999" });
    expect((await getInvoiceView(owner, bill.id)).lines[0].unitPrice).toBeDefined();
    expect((await prisma.billLineItem.findFirstOrThrow({ where: { billId: bill.id } })).unitPrice.toString()).toBe("130");
  });
});

describe("changing rates over time", () => {
  it("quick edit changes any rate or clears A and C, and every real change is kept in the history", async () => {
    const { owner, item } = await world();
    const edited = await quickEditProduct(owner, { id: item.id, rateA: "85", unitPrice: "105", rateC: "" });
    expect(edited.rateA?.toString()).toBe("85");
    expect(edited.unitPrice.toString()).toBe("105");
    expect(edited.rateC).toBeNull();

    await quickEditProduct(owner, { id: item.id, rateA: "85" }); // unchanged: no new history
    const detail = await getProductDetail(owner, item.id);
    expect(detail.rateChanges.map((c) => [c.tier, c.oldRate?.toString() ?? null, c.newRate?.toString() ?? null]).sort()).toEqual([
      ["A", "80", "85"], ["B", "100", "105"], ["C", "130", null],
    ]);
    await expect(quickEditProduct(owner, { id: item.id })).rejects.toThrow();
    await expect(quickEditProduct(owner, { id: item.id, unitPrice: "-1" })).rejects.toThrow();
  });

  it("the full edit form also writes the history, and a history row can never be edited", async () => {
    const { owner, item } = await world();
    await updateProduct(owner, { id: item.id, name: "Birthday 12", ...base, unitPrice: "110", rateA: "80", rateC: "130" });
    expect(await prisma.productRateChange.count({ where: { productId: item.id } })).toBe(1);
    await expect(prisma.productRateChange.updateMany({ data: { reason: "tampered" } })).rejects.toThrow();
  });

  it("when wax goes up, every set rate can be raised by a percentage at once", async () => {
    const { owner, worker, item } = await world();
    const noA = await createProduct(owner, { ...base, name: "Only B", unitPrice: "10" });
    const unpriced = await createProduct(owner, { ...base, name: "Unpriced", unitPrice: "0" });
    const off = await createProduct(owner, { ...base, name: "Off", unitPrice: "20" });
    await prisma.product.update({ where: { id: off.id }, data: { isActive: false } });

    const result = await adjustRates(owner, { percent: "10", tiers: ["A", "B", "C"] });
    expect(result.changedItems).toBe(2);
    const after = await prisma.product.findUniqueOrThrow({ where: { id: item.id } });
    expect([after.rateA?.toString(), after.unitPrice.toString(), after.rateC?.toString()]).toEqual(["88", "110", "143"]);
    const b = await prisma.product.findUniqueOrThrow({ where: { id: noA.id } });
    expect(b.unitPrice.toString()).toBe("11");
    expect(b.rateA).toBeNull(); // an empty rate stays "same as B"
    expect((await prisma.product.findUniqueOrThrow({ where: { id: unpriced.id } })).unitPrice.toString()).toBe("0");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: off.id } })).unitPrice.toString()).toBe("20");
    expect(await prisma.productRateChange.count({ where: { reason: "All rates up 10%" } })).toBe(4);

    // Only the chosen rates, and down as well as up.
    await adjustRates(owner, { percent: "-50", tiers: ["C"] });
    const c = await prisma.product.findUniqueOrThrow({ where: { id: item.id } });
    expect([c.rateA?.toString(), c.unitPrice.toString(), c.rateC?.toString()]).toEqual(["88", "110", "71.5"]);

    for (const bad of ["0", "abc", "500", "-95", ""]) await expect(adjustRates(owner, { percent: bad, tiers: ["B"] })).rejects.toBeInstanceOf(ValidationError);
    await expect(adjustRates(owner, { percent: "5", tiers: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(adjustRates(worker, { percent: "5", tiers: ["B"] })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an Excel price list can carry Rate A and Rate C columns", async () => {
    const owner = await makeUser("OWNER");
    const rows = mapProductRows([{ rowNumber: 2, values: { name: "Masjid 8", hsn: "3406", gst: "5", rateb: "40", ratea: "35", ratec: "48" } }]);
    expect(rows[0]).toMatchObject({ unitPrice: "40", rateA: "35", rateC: "48" });
    expect(await importProducts(owner, { rows, dryRun: false })).toMatchObject({ created: 1 });
    const p = await prisma.product.findFirstOrThrow({ where: { name: "Masjid 8" } });
    expect([p.rateA?.toString(), p.unitPrice.toString(), p.rateC?.toString()]).toEqual(["35", "40", "48"]);
  });
});
