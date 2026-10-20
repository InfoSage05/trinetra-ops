import { describe, it, expect } from "vitest";
import { whatsappShareUrl, invoiceShareText } from "@/lib/share";

describe("share", () => {
  it("builds a WhatsApp link to an Indian mobile, or a picker link without one", () => {
    expect(whatsappShareUrl("+91 98765 43210", "Hi there")).toBe("https://wa.me/919876543210?text=Hi%20there");
    expect(whatsappShareUrl(null, "Hi")).toBe("https://wa.me/?text=Hi");
  });
  it("summarises an invoice in plain words", () => {
    const text = invoiceShareText({ supplierName: "Trinetra Candles", invoiceNumber: "TC/2627/00007", invoiceDate: "20-10-2026", grandTotal: "1770", amountDue: "1000", upiPayUri: null });
    expect(text).toContain("TC/2627/00007");
    expect(text).toContain("₹1,770.00");
    expect(text).toContain("Balance due: ₹1,000.00");
  });
});
