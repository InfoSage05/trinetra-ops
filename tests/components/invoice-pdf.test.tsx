import { describe, it, expect, beforeEach } from "vitest";
import { createBill } from "@/domain/billing";
import { getInvoiceView } from "@/domain/invoice-view";
import { toPlain } from "@/lib/action-result";
import { invoiceQrCodes } from "@/lib/qr";
import { renderInvoicePdf } from "@/components/invoice-pdf";
import { resetDb } from "../helpers/db";
import { makeBusinessProfile, setupBillingWorld } from "../helpers/factories";

describe("renderInvoicePdf", () => {
  beforeEach(resetDb);

  it("renders a real PDF including the UPI QR code", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    await makeBusinessProfile({ upiId: "trinetra@okhdfcbank" });
    const bill = await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "pdf-bill-00000001", lines: [{ productId: product.id, quantity: "3" }] });
    const view = toPlain(await getInvoiceView(owner, bill.id));
    const qrs = await invoiceQrCodes(view);
    expect(qrs.upiQr).toMatch(/^data:image\/png;base64,/);

    const pdf = await renderInvoicePdf(view, qrs);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(5000);
  });
});
