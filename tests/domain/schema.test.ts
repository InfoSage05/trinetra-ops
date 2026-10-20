import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "../helpers/db";

describe("schema", () => {
  beforeEach(resetDb);

  it("stores a full bill graph: customer, product, bill, line, ledger, payment, credit note, IRP job", async () => {
    const user = await prisma.user.create({ data: { name: "Owner", phone: "9000000001", passwordHash: "x", role: "OWNER" } });
    const customer = await prisma.customer.create({ data: { name: "Ramesh Traders", billingAddress: "Market Rd, Cuttack", stateCode: "21" } });
    const product = await prisma.product.create({
      data: { sku: "LJC-01", name: "Lavender Jar Candle", hsnCode: "3406", unitPrice: "150.00", gstRate: "18.00" },
    });
    await prisma.numberSeries.create({ data: { series: "INVOICE", financialYear: "2026-27", prefix: "TC" } });

    const bill = await prisma.bill.create({
      data: {
        invoiceNumber: "TC/2627/00001", financialYear: "2026-27", customerId: customer.id,
        customerName: customer.name, customerAddress: customer.billingAddress, customerStateCode: "21",
        supplierLegalName: "Trinetra Candles", supplierGstin: "21AAAAA0000A1ZE", supplierAddress: "Factory Rd", supplierStateCode: "21",
        placeOfSupply: "21", grossTotal: "150.00", discountTotal: "0.00", taxableTotal: "150.00",
        cgstTotal: "13.50", sgstTotal: "13.50", igstTotal: "0.00", taxTotal: "27.00", roundOff: "0.00", grandTotal: "177.00",
        createdBy: user.id, idempotencyKey: "schema-bill-1",
        lineItems: {
          create: [{
            lineNo: 1, productId: product.id, productName: product.name, productSku: product.sku, hsnCode: "3406", unit: "pcs",
            quantity: "1.00", unitPrice: "150.00", taxableValue: "150.00", gstRate: "18.00",
            cgstAmount: "13.50", sgstAmount: "13.50", igstAmount: "0.00", lineTotal: "177.00",
          }],
        },
        payments: { create: [{ amount: "177.00", method: "CASH", recordedBy: user.id, idempotencyKey: "schema-pay-1" }] },
      },
      include: { lineItems: true, payments: true },
    });

    await prisma.stockLedgerEntry.create({
      data: { productId: product.id, quantityDelta: "-1.00", type: "BILLED", createdBy: user.id, idempotencyKey: "schema-led-1" },
    });
    const note = await prisma.creditNote.create({
      data: {
        creditNoteNumber: "CN/2627/00001", financialYear: "2026-27", billId: bill.id, reason: "Damaged", restock: false,
        taxableTotal: "150.00", cgstTotal: "13.50", sgstTotal: "13.50", igstTotal: "0.00", taxTotal: "27.00",
        roundOff: "0.00", grandTotal: "177.00", createdBy: user.id, idempotencyKey: "schema-cn-1",
        lines: {
          create: [{
            billLineItemId: bill.lineItems[0].id, productId: product.id, quantity: "1.00", taxableValue: "150.00",
            cgstAmount: "13.50", sgstAmount: "13.50", igstAmount: "0.00", lineTotal: "177.00",
          }],
        },
      },
    });
    const job = await prisma.irpSubmission.create({ data: { documentType: "INVOICE", billId: bill.id } });

    expect(bill.lineItems).toHaveLength(1);
    expect(bill.payments[0].amount.toString()).toBe("177");
    expect(note.restock).toBe(false);
    expect(job.status).toBe("PENDING");
  });

  it("enforces unique idempotency keys on ledger rows", async () => {
    const product = await prisma.product.create({
      data: { sku: "RJC-01", name: "Rose Jar Candle", hsnCode: "3406", unitPrice: "150.00", gstRate: "18.00" },
    });
    const row = { productId: product.id, quantityDelta: "5.00", type: "PRODUCED" as const, createdBy: "u1", idempotencyKey: "dup-key" };
    await prisma.stockLedgerEntry.create({ data: row });
    await expect(prisma.stockLedgerEntry.create({ data: row })).rejects.toThrow();
  });
});
