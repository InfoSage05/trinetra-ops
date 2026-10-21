import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createProduct } from "@/domain/products";
import { importProducts, mapProductRows } from "@/domain/imports";
import { createBill, previewBill } from "@/domain/billing";
import { getInvoiceView } from "@/domain/invoice-view";
import { recordReturn } from "@/domain/credit-notes";
import { getCurrentStock } from "@/domain/stock";
import { ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { addStock, makeBusinessProfile, makeCustomer, makeProduct, makeSeries, makeUser, MAHARASHTRA } from "../helpers/factories";

beforeEach(resetDb);

async function world() {
  await makeBusinessProfile();
  await makeSeries("INVOICE");
  await makeSeries("CREDIT_NOTE");
  const owner = await makeUser("OWNER");
  const customer = await makeCustomer();
  const birthday = await makeProduct({ name: "Birthday Candle", qtyPerCarton: 12, unitPrice: "10.00", gstRate: "18.00" });
  const masjid = await makeProduct({ name: "Masjid Candle", qtyPerCarton: 40, unitPrice: "5.00", gstRate: "12.00" });
  await addStock(birthday.id, "100.00");
  await addStock(masjid.id, "400.00");
  return { owner, customer, birthday, masjid };
}

describe("pieces per carton on products", () => {
  it("is stored per product, defaults to 1, and must be a whole number of at least 1", async () => {
    const owner = await makeUser("OWNER");
    const base = { name: "Flower Candle", hsnCode: "3406", unitPrice: "20", gstRate: "18" };
    const p = await createProduct(owner, { ...base, sku: "FL-1", qtyPerCarton: "24" });
    expect(p.qtyPerCarton).toBe(24);
    expect((await createProduct(owner, { ...base, name: "Flower Candle 2", sku: "FL-2" })).qtyPerCarton).toBe(1);
    for (const bad of ["0", "-3", "2.5", "abc"]) {
      await expect(createProduct(owner, { ...base, name: `Flower ${bad}`, sku: `FL-${bad}`, qtyPerCarton: bad })).rejects.toThrow(ValidationError);
    }
  });

  it("is read from an Excel column named like 'Qty per carton'", async () => {
    const owner = await makeUser("OWNER");
    const rows = mapProductRows([{ rowNumber: 2, values: { sku: "B1", name: "Birthday", hsn: "3406", gst: "18", price: "10", qtypercarton: "12" } }]);
    await importProducts(owner, { rows, dryRun: false });
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: "B1" } })).qtyPerCarton).toBe(12);
  });
});

describe("billing in cartons", () => {
  it("turns cartons (+ loose pieces) into total pieces using each product's own carton size", async () => {
    const { owner, customer, birthday, masjid } = await world();
    const preview = await previewBill(owner, {
      customerId: customer.id, placeOfSupply: "21",
      lines: [{ productId: birthday.id, cartons: "3", loosePieces: "5" }, { productId: masjid.id, cartons: "2" }],
    });
    expect(preview.lines[0].quantity.toString()).toBe("41"); // 3 x 12 + 5
    expect(preview.lines[0].qtyPerCarton).toBe(12);
    expect(preview.lines[1].quantity.toString()).toBe("80"); // 2 x 40
    expect(preview.lines[1].qtyPerCarton).toBe(40);
    expect(preview.lines[1].cartons.toString()).toBe("2");
  });

  it("still accepts a plain quantity in pieces, but not both ways at once, and not zero", async () => {
    const { owner, customer, birthday } = await world();
    const draft = { customerId: customer.id, placeOfSupply: "21" };
    const ok = await previewBill(owner, { ...draft, lines: [{ productId: birthday.id, quantity: "24" }] });
    expect(ok.lines[0].cartons.toString()).toBe("2");
    await expect(previewBill(owner, { ...draft, lines: [{ productId: birthday.id, quantity: "24", cartons: "2" }] })).rejects.toThrow(ValidationError);
    await expect(previewBill(owner, { ...draft, lines: [{ productId: birthday.id, cartons: "0" }] })).rejects.toThrow(ValidationError);
    await expect(previewBill(owner, { ...draft, lines: [{ productId: birthday.id }] })).rejects.toThrow(ValidationError);
  });

  it("deducts pieces from stock and snapshots the carton size on the invoice line", async () => {
    const { owner, customer, birthday } = await world();
    const bill = await createBill(owner, {
      customerId: customer.id, placeOfSupply: "21", idempotencyKey: "ct-bill-0001",
      lines: [{ productId: birthday.id, cartons: "3" }],
    });
    expect(bill.lineItems[0].quantity.toString()).toBe("36");
    expect(bill.lineItems[0].qtyPerCarton).toBe(12);
    expect((await getCurrentStock(prisma, birthday.id)).toFixed(2)).toBe("64.00");
    await prisma.product.update({ where: { id: birthday.id }, data: { qtyPerCarton: 6 } });
    expect((await prisma.billLineItem.findFirstOrThrow({ where: { billId: bill.id } })).qtyPerCarton).toBe(12);
  });
});

describe("extra charges (carton, crate, freight)", () => {
  const twoLines = (birthday: { id: string }, masjid: { id: string }) => [
    { productId: birthday.id, cartons: "1" }, // 12 x 10.00 = 120.00 @ 18%
    { productId: masjid.id, cartons: "1" }, // 40 x 5.00 = 200.00 @ 12%
  ];

  it("adds charges to the taxable value, taxed at the highest item rate unless set", async () => {
    const { owner, customer, birthday, masjid } = await world();
    const bill = await createBill(owner, {
      customerId: customer.id, placeOfSupply: "21", idempotencyKey: "ch-bill-0001", lines: twoLines(birthday, masjid),
      charges: [{ kind: "CARTON", amount: "100" }, { kind: "FREIGHT", amount: "50", gstRate: "5" }],
    });
    const charges = await prisma.billCharge.findMany({ where: { billId: bill.id }, orderBy: { chargeNo: "asc" } });
    expect(charges.map((c) => [c.kind, c.taxableValue.toString(), c.gstRate.toString(), c.cgstAmount.toString()])).toEqual([
      ["CARTON", "100", "18", "9"], ["FREIGHT", "50", "5", "1.25"],
    ]);
    expect([bill.taxableTotal, bill.cgstTotal, bill.sgstTotal, bill.taxTotal, bill.roundOff, bill.grandTotal].map(String))
      .toEqual(["470", "33.05", "33.05", "66.1", "-0.1", "536"]);
    // gross - discount = taxable still holds with charges included
    expect(Number(bill.grossTotal) - Number(bill.discountTotal)).toBe(Number(bill.taxableTotal));
  });

  it("charges IGST on charges for inter-state supply", async () => {
    const { owner, customer, birthday, masjid } = await world();
    const bill = await createBill(owner, {
      customerId: customer.id, placeOfSupply: MAHARASHTRA, idempotencyKey: "ch-bill-0002", lines: twoLines(birthday, masjid),
      charges: [{ kind: "CRATE", amount: "100" }],
    });
    const [crate] = await prisma.billCharge.findMany({ where: { billId: bill.id } });
    expect([crate.cgstAmount.toString(), crate.igstAmount.toString()]).toEqual(["0", "18"]);
  });

  it("rejects duplicate carton/crate/freight rows and non-positive amounts", async () => {
    const { owner, customer, birthday } = await world();
    const draft = { customerId: customer.id, placeOfSupply: "21", lines: [{ productId: birthday.id, cartons: "1" }] };
    await expect(previewBill(owner, { ...draft, charges: [{ kind: "CARTON", amount: "10" }, { kind: "CARTON", amount: "5" }] })).rejects.toThrow(ValidationError);
    await expect(previewBill(owner, { ...draft, charges: [{ kind: "FREIGHT", amount: "0" }] })).rejects.toThrow(ValidationError);
  });

  it("are immutable once posted, appear on the invoice view, and do not block returns", async () => {
    const { owner, customer, birthday, masjid } = await world();
    const bill = await createBill(owner, {
      customerId: customer.id, placeOfSupply: "21", idempotencyKey: "ch-bill-0003", lines: twoLines(birthday, masjid),
      charges: [{ kind: "FREIGHT", amount: "50" }],
    });
    const charge = await prisma.billCharge.findFirstOrThrow({ where: { billId: bill.id } });
    await expect(prisma.billCharge.update({ where: { id: charge.id }, data: { taxableValue: "1.00" } })).rejects.toThrow(/immutable/);

    const view = await getInvoiceView(owner, bill.id);
    expect(view.charges.map((c) => [c.kind, c.label])).toEqual([["FREIGHT", "Freight charges"]]);
    expect(view.lines[0].cartons).toBe("1");
    expect(view.lines[0].qtyPerCarton).toBe(12);

    const note = await recordReturn(owner, { billId: bill.id, reason: "x", lines: [{ billLineItemId: bill.lineItems[0].id, quantity: "6" }], idempotencyKey: "ch-cn-0001" });
    expect(note.grandTotal.toFixed(2)).toBe("70.80"); // 6 x 10 = 60 + 18% only; the charge is not credited
  });
});

describe("re-importing a price list", () => {
  it("does not reset carton sizes when the sheet has no carton column", async () => {
    const owner = await makeUser("OWNER");
    const p = await makeProduct({ sku: "KEEP-1", name: "Keep Me", qtyPerCarton: 24 });
    const row = { rowNumber: 2, sku: "KEEP-1", name: "Keep Me", hsnCode: "3406", unitPrice: "12", gstRate: "18" };
    await importProducts(owner, { rows: [row], dryRun: false });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).qtyPerCarton).toBe(24);
    await importProducts(owner, { rows: [{ ...row, qtyPerCarton: "30" }], dryRun: false });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).qtyPerCarton).toBe(30);
  });
});

describe("most items on one bill", () => {
  it("allows 50 items and refuses 51", async () => {
    await makeBusinessProfile();
    await makeSeries("INVOICE");
    const owner = await makeUser("OWNER");
    const customer = await makeCustomer();
    const products = await Promise.all(Array.from({ length: 51 }, (_, i) => makeProduct({ name: `Item ${i + 1}`, sku: `ITEM-${i + 1}` })));
    const lines = (n: number) => products.slice(0, n).map((p) => ({ productId: p.id, quantity: "1" }));
    await expect(previewBill(owner, { customerId: customer.id, placeOfSupply: "21", lines: lines(51) })).rejects.toThrow(/at most 50 items/);
    const preview = await previewBill(owner, { customerId: customer.id, placeOfSupply: "21", lines: lines(50) });
    expect(preview.lines).toHaveLength(50);
  });
});
