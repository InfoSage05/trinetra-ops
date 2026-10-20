import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createBill } from "@/domain/billing";
import { recordReturn } from "@/domain/credit-notes";
import { getPaymentSummary, recordPayment } from "@/domain/payments";
import { submitStockCount, discardStockCount } from "@/domain/stock-counts";
import { listBills } from "@/domain/reports";
import { authenticate } from "@/domain/authentication";
import { listProducts } from "@/domain/products";
import { searchCustomers, setCustomerActive } from "@/domain/customers";
import { importProducts, mapProductRows } from "@/domain/imports";
import { getCreditNoteView } from "@/domain/invoice-view";
import { safeNextPath } from "@/lib/safe-redirect";
import { sumDecimals } from "@/lib/money";
import { ForbiddenError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { addStock, makeCustomer, makeProduct, makeUser, setupBillingWorld, MAHARASHTRA } from "../helpers/factories";

beforeEach(resetDb);

describe("review fix 1: duplicate pending stock counts", () => {
  it("refuses a second pending count for the same product until the first is resolved", async () => {
    const worker = await makeUser("WORKER");
    const owner = await makeUser("OWNER");
    const p = await makeProduct();
    await addStock(p.id, "50.00");
    const first = await submitStockCount(worker, { productId: p.id, countedQuantity: "40" });
    await expect(submitStockCount(worker, { productId: p.id, countedQuantity: "40" })).rejects.toMatchObject({ code: "PENDING_COUNT_EXISTS" });
    await discardStockCount(owner, { stockCountId: first.id });
    await expect(submitStockCount(worker, { productId: p.id, countedQuantity: "41" })).resolves.toBeTruthy();
  });
});

describe("review fix 2/3: credit notes add up to the invoice", () => {
  it("fully returning a line in parts credits exactly the invoice total", async () => {
    const w = await setupBillingWorld();
    const p = await makeProduct({ unitPrice: "10.17", gstRate: "0.00" });
    await addStock(p.id, "10.00");
    const bill = await createBill(w.owner, { customerId: w.customer.id, placeOfSupply: "21", idempotencyKey: "rf-bill-0001", lines: [{ productId: p.id, quantity: "3" }] });
    expect(bill.grandTotal.toString()).toBe("31");
    const lineId = bill.lineItems[0].id;

    const totals: string[] = [];
    for (const k of ["a", "b", "c"]) {
      const note = await recordReturn(w.owner, { billId: bill.id, reason: "unit", lines: [{ billLineItemId: lineId, quantity: "1" }], idempotencyKey: `rf-cn-000${k}` });
      totals.push(note.grandTotal.toFixed(2));
    }
    expect(sumDecimals(totals).toFixed(2)).toBe("31.00");
    const summary = await getPaymentSummary(prisma, bill.id);
    expect([summary.netReceivable.toFixed(2), summary.status]).toEqual(["0.00", "PAID"]);
  });

  it("never reverses more tax than was charged across partial returns", async () => {
    const w = await setupBillingWorld();
    const p = await makeProduct({ unitPrice: "3.34", gstRate: "5.00" });
    await addStock(p.id, "10.00");
    const bill = await createBill(w.owner, {
      customerId: w.customer.id, placeOfSupply: MAHARASHTRA, idempotencyKey: "rf-bill-0002",
      lines: [{ productId: p.id, quantity: "3", discountAmount: "0.02" }], // taxable 10.00, IGST 0.50
    });
    expect(bill.igstTotal.toString()).toBe("0.5");
    const lineId = bill.lineItems[0].id;
    for (const k of ["a", "b", "c"]) {
      await recordReturn(w.owner, { billId: bill.id, reason: "unit", lines: [{ billLineItemId: lineId, quantity: "1" }], idempotencyKey: `rf-tx-000${k}` });
    }
    const lines = await prisma.creditNoteLine.findMany({ where: { billLineItemId: lineId } });
    expect(sumDecimals(lines.map((l) => l.igstAmount)).toFixed(2)).toBe("0.50");
  });
});

describe("review fix 5: bill list filters before limiting", () => {
  it("still finds an old unpaid bill when many newer bills are paid; DUE covers unpaid and part-paid", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const line = [{ productId: product.id, quantity: "1" }];
    const unpaid = await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "lb-bill-0001", lines: line });
    const part = await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "lb-bill-0002", lines: line });
    await recordPayment(owner, { billId: part.id, amount: "50", method: "CASH", idempotencyKey: "lb-pay-0001" });
    for (const k of ["3", "4", "5"]) {
      await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: `lb-bill-000${k}`, lines: line, initialPayment: { amount: "177", method: "CASH" } });
    }
    const onlyUnpaid = await listBills(owner, { status: "UNPAID", take: 2 });
    expect(onlyUnpaid.map((b) => b.id)).toEqual([unpaid.id]);
    const due = await listBills(owner, { status: "DUE", take: 2 });
    expect(due.map((b) => b.id).sort()).toEqual([unpaid.id, part.id].sort());
  });
});

describe("review fix 6: login lockout survives parallel guessing", () => {
  it("locks the account even when wrong guesses arrive at the same time", async () => {
    await makeUser("WORKER", { phone: "9876500055", password: "right-password-1" });
    await Promise.all(Array.from({ length: 8 }, () => authenticate("9876500055", "wrong")));
    const result = await authenticate("9876500055", "right-password-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Too many wrong attempts/);
  });
});

describe("review fix 7: safe redirect", () => {
  it("accepts only same-site absolute paths", () => {
    expect(safeNextPath("/bills?status=UNPAID")).toBe("/bills?status=UNPAID");
    expect(safeNextPath(undefined)).toBe("/dashboard");
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "evil.com", "/ok\\no", "/a\nb"]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
  });
});

describe("review fix 8: price data is owner-only in the domain layer", () => {
  it("rejects workers listing products with prices", async () => {
    const worker = await makeUser("WORKER");
    await expect(listProducts(worker, {})).rejects.toThrow(ForbiddenError);
  });
});

describe("review fix 12: hidden customers can be found and restored", () => {
  it("includes hidden customers on request and lets the owner un-hide them", async () => {
    const owner = await makeUser("OWNER");
    const c = await makeCustomer({ name: "Hidden Traders" });
    await setCustomerActive(owner, { id: c.id, isActive: false });
    expect((await searchCustomers(owner, { query: "Hidden" })).length).toBe(0);
    const withHidden = await searchCustomers(owner, { query: "Hidden", includeInactive: true });
    expect(withHidden.map((x) => x.id)).toEqual([c.id]);
    await setCustomerActive(owner, { id: c.id, isActive: true });
    expect((await searchCustomers(owner, { query: "Hidden" })).length).toBe(1);
  });
});

describe("review fix 13: Excel percent cells", () => {
  it("rejects a GST value that looks like a fraction (0.18) instead of silently charging 0.18%", async () => {
    const owner = await makeUser("OWNER");
    const rows = mapProductRows([{ rowNumber: 2, values: { sku: "P1", name: "Pct", hsn: "3406", gst: "0.18", price: "10" } }]);
    const result = await importProducts(owner, { rows, dryRun: true });
    expect(result.errors[0]).toMatchObject({ rowNumber: 2 });
    expect(result.errors[0].message).toMatch(/fraction|18/i);
  });
});

describe("review fix 11: printable credit note", () => {
  it("returns every particular of a credit note, tied to the original invoice", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const bill = await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "cv-bill-0001", lines: [{ productId: product.id, quantity: "4" }] });
    const note = await recordReturn(owner, { billId: bill.id, reason: "Broken", lines: [{ billLineItemId: bill.lineItems[0].id, quantity: "2" }], idempotencyKey: "cv-cn-0001" });
    const view = await getCreditNoteView(owner, note.id);
    expect(view.creditNoteNumber).toBe(note.creditNoteNumber);
    expect(view.originalInvoiceNumber).toBe(bill.invoiceNumber);
    expect(view.supplier.gstin).toBe("21AAAAA0000A1ZE");
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0].productName).toBe(product.name);
    expect(view.amountInWords).toMatch(/Rupees/);
    expect(view.reason).toBe("Broken");
  });
});
