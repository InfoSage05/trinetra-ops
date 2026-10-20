import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createBill } from "@/domain/billing";
import { getInvoiceView } from "@/domain/invoice-view";
import { resetDb } from "../helpers/db";
import { makeBusinessProfile, makeProduct, addStock, setupBillingWorld } from "../helpers/factories";

describe("getInvoiceView", () => {
  beforeEach(resetDb);

  it("contains every particular the printed invoice needs", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    await makeBusinessProfile({ upiId: "trinetra@okhdfcbank", invoiceTerms: "Goods once sold will not be taken back." });
    const second = await makeProduct({ gstRate: "12.00", hsnCode: "340600" });
    await addStock(second.id, "10.00");
    const bill = await createBill(owner, {
      customerId: customer.id, placeOfSupply: "21", idempotencyKey: "view-bill-0001",
      lines: [{ productId: product.id, quantity: "10" }, { productId: second.id, quantity: "1" }],
    });

    const view = await getInvoiceView(owner, bill.id);
    expect(view.invoiceNumber).toBe(bill.invoiceNumber);
    expect(view.supplier.gstin).toBe("21AAAAA0000A1ZE");
    expect(view.placeOfSupplyLabel).toBe("Odisha (21)");
    expect(view.reverseCharge).toBe("No");
    expect(view.lines).toHaveLength(2);
    expect(view.taxSummary.map((t) => [t.hsnCode, t.gstRate])).toEqual([["3406", "18"], ["340600", "12"]]);
    expect(view.amountInWords).toMatch(/Rupees/);
    expect(view.payment.status).toBe("UNPAID");
    expect(view.upiPayUri).toMatch(/^upi:\/\/pay\?pa=trinetra%40okhdfcbank&pn=Trinetra%20Candles&am=\d+\.\d{2}&cu=INR&tn=/);
    expect(view.terms).toBe("Goods once sold will not be taken back.");
    expect(await prisma.bill.count()).toBe(1);
  });
});
