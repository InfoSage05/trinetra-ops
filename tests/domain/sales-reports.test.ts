import { describe, it, expect, beforeEach } from "vitest";
import { createBill } from "@/domain/billing";
import { recordReturn } from "@/domain/credit-notes";
import { recordPayment } from "@/domain/payments";
import { getOwnerDashboard } from "@/domain/reports";
import { ageBucket, getDuesAgeing, getSalesReport, getStockMovementReport, hsnSummaryCsv, salesRegisterCsv } from "@/domain/sales-reports";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { istToday } from "@/lib/time";
import { resetDb } from "../helpers/db";
import { addStock, makeBusinessProfile, makeCustomer, makeProduct, makeSeries, makeUser } from "../helpers/factories";

beforeEach(resetDb);

async function world() {
  await makeBusinessProfile();
  await makeSeries("INVOICE");
  await makeSeries("CREDIT_NOTE");
  const owner = await makeUser("OWNER");
  const worker = await makeUser("WORKER");
  const customer = await makeCustomer({ name: "=cmd|' /C calc'!A0" }); // a spreadsheet would run this as a formula
  const other = await makeCustomer({ name: "Other Shop" });
  const rose = await makeProduct({ name: "Rose Candle", qtyPerCarton: 10, unitPrice: "10.00", gstRate: "18.00", hsnCode: "3406" });
  const diya = await makeProduct({ name: "Diya", qtyPerCarton: 5, unitPrice: "20.00", gstRate: "12.00", hsnCode: "3406" });
  await addStock(rose.id, "200.00");
  await addStock(diya.id, "100.00");
  // Bill A: 2 cartons rose (20 x 10 = 200 + 18%) + freight 100. Bill B: 1 carton diya (5 x 20 = 100 + 12%).
  const a = await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "sr-bill-0001", lines: [{ productId: rose.id, cartons: "2" }], charges: [{ kind: "FREIGHT", amount: "100" }] });
  const b = await createBill(owner, { customerId: other.id, placeOfSupply: "21", idempotencyKey: "sr-bill-0002", lines: [{ productId: diya.id, cartons: "1" }] });
  const range = { from: istToday(), to: istToday() };
  return { owner, worker, customer, other, rose, diya, a, b, range };
}

describe("sales report", () => {
  it("adds up bills, credit notes, products and customers for the range", async () => {
    const { owner, a, b, range } = await world();
    const report = await getSalesReport(owner, range);
    expect(report.billCount).toBe(2);
    expect(report.taxable.toString()).toBe("400"); // 200 + 100 freight + 100
    expect(report.billed.toString()).toBe(a.grandTotal.plus(b.grandTotal).toString());
    expect(report.byProduct.map((p) => p.name).sort()).toEqual(["Diya", "Rose Candle"]);
    expect(report.byCustomer[0].total.greaterThanOrEqualTo(report.byCustomer[1].total)).toBe(true);
    expect(report.byDay).toHaveLength(1);
    expect(report.byDay[0].bills).toBe(2);

    const note = await recordReturn(owner, { billId: a.id, reason: "broken", lines: [{ billLineItemId: a.lineItems[0].id, quantity: "10" }], idempotencyKey: "sr-cn-0001" });
    const after = await getSalesReport(owner, range);
    expect(after.creditNoteCount).toBe(1);
    expect(after.netSales.toString()).toBe(after.billed.minus(note.grandTotal).toString());
  });

  it("refuses a bad range and workers", async () => {
    const { owner, worker, range } = await world();
    await expect(getSalesReport(owner, { from: "2026-12-31", to: "2026-01-01" })).rejects.toBeInstanceOf(ValidationError);
    await expect(getSalesReport(owner, { from: "2026-02-30", to: "2026-03-01" })).rejects.toBeInstanceOf(ValidationError);
    await expect(getSalesReport(owner, { from: "2020-01-01", to: "2026-01-01" })).rejects.toBeInstanceOf(ValidationError);
    await expect(getSalesReport(worker, range)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("dues", () => {
  it("lists money owing in one query and the dashboard agrees; payments and credit notes reduce it", async () => {
    const { owner, a, b } = await world();
    const before = await getDuesAgeing(owner);
    expect(before.grandTotal.toString()).toBe(a.grandTotal.plus(b.grandTotal).toString());
    expect(before.totals["0-30"].toString()).toBe(before.grandTotal.toString());
    expect(before.customers).toHaveLength(2);

    await recordPayment(owner, { billId: b.id, amount: b.grandTotal.toString(), method: "CASH", idempotencyKey: "sr-pay-0001" });
    const after = await getDuesAgeing(owner);
    expect(after.customers).toHaveLength(1);
    expect(after.grandTotal.toString()).toBe(a.grandTotal.toString());
    expect((await getOwnerDashboard(owner)).totalDue.toString()).toBe(a.grandTotal.toString());
  });

  it("puts old bills in the right age bucket", () => {
    expect([0, 30, 31, 60, 61, 90, 91, 400].map(ageBucket)).toEqual(["0-30", "0-30", "31-60", "31-60", "61-90", "61-90", "90+", "90+"]);
  });
});

describe("stock movement report", () => {
  it("shows opening, made, sold, returned and closing for each item", async () => {
    const { owner, rose, range } = await world();
    const report = await getStockMovementReport(owner, range);
    const row = report.items.find((i) => i.id === rose.id)!;
    expect(row.opening.toString()).toBe("0");
    expect(row.produced.toString()).toBe("200");
    expect(row.sold.toString()).toBe("20");
    expect(row.closing.toString()).toBe("180");
  });
});

describe("GST exports", () => {
  it("sales register lists invoices and credit notes (negative) and defuses spreadsheet formulas", async () => {
    const { owner, a, range } = await world();
    await recordReturn(owner, { billId: a.id, reason: "broken", lines: [{ billLineItemId: a.lineItems[0].id, quantity: "10" }], idempotencyKey: "sr-cn-0002" });
    const csv = await salesRegisterCsv(owner, range);
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain("Taxable value");
    expect(lines.filter((l) => l.startsWith("Invoice"))).toHaveLength(2);
    const note = lines.find((l) => l.startsWith("Credit note"))!;
    expect(note).toContain(",-"); // negative amounts
    expect(csv).toContain("'=cmd"); // the formula-looking name is prefixed so it stays text
    expect(csv).not.toMatch(/(^|,)"?=cmd/m);
  });

  it("HSN summary groups by HSN and rate, includes charges, and nets off credit notes", async () => {
    const { owner, a, range } = await world();
    const csv = await hsnSummaryCsv(owner, range);
    const rows = csv.split("\r\n").map((l) => l.split(","));
    const rose18 = rows.find((r) => r[0] === "3406" && r[1] === "18.00")!;
    const diya12 = rows.find((r) => r[0] === "3406" && r[1] === "12.00")!;
    const charges = rows.find((r) => r[0] === "CHARGES")!;
    expect(rose18[4]).toBe("200.00");
    expect(diya12[4]).toBe("100.00");
    expect(charges[4]).toBe("100.00");

    await recordReturn(owner, { billId: a.id, reason: "broken", lines: [{ billLineItemId: a.lineItems[0].id, quantity: "10" }], idempotencyKey: "sr-cn-0003" });
    const net = (await hsnSummaryCsv(owner, range)).split("\r\n").map((l) => l.split(",")).find((r) => r[0] === "3406" && r[1] === "18.00")!;
    expect(net[4]).toBe("100.00"); // half the cartons came back
  });

  it("refuses an export with nothing in it, and workers", async () => {
    const { owner, worker, range } = await world();
    await expect(hsnSummaryCsv(owner, { from: "2020-01-01", to: "2020-01-31" })).rejects.toBeInstanceOf(ValidationError);
    await expect(salesRegisterCsv(worker, range)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
