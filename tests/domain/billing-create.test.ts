import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createBill } from "@/domain/billing";
import { getCurrentStock } from "@/domain/stock";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeBusinessProfile, makeCustomer, setupBillingWorld, ODISHA_CUSTOMER_GSTIN } from "../helpers/factories";

const stock = async (id: string) => (await getCurrentStock(prisma, id)).toFixed(2);

describe("createBill", () => {
  beforeEach(resetDb);

  it("commits bill, number, snapshots and stock deduction together", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const bill = await createBill(owner, {
      customerId: customer.id, placeOfSupply: "21", idempotencyKey: "bill-key-0001",
      lines: [{ productId: product.id, quantity: "10" }],
    });

    expect(bill.invoiceNumber).toMatch(/^TC\/\d{4}\/00001$/);
    expect(bill.grandTotal.toString()).toBe("1770");
    expect(bill.customerName).toBe(customer.name);
    expect(bill.supplierGstin).toBe("21AAAAA0000A1ZE");
    expect(await stock(product.id)).toBe("90.00");

    const entry = await prisma.stockLedgerEntry.findFirstOrThrow({ where: { type: "BILLED" } });
    expect(entry.sourceReference).toBe(`bill_line:${bill.lineItems[0].id}`);

    // Later catalogue edits must not change a posted invoice.
    await prisma.product.update({ where: { id: product.id }, data: { name: "Renamed", unitPrice: "999.00" } });
    const reread = await prisma.billLineItem.findFirstOrThrow({ where: { billId: bill.id } });
    expect([reread.productName, reread.unitPrice.toString()]).toEqual([product.name, "150"]);
  });

  it("refuses an unconfirmed shortfall without consuming a number, then bills it when confirmed", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const draft = { customerId: customer.id, placeOfSupply: "21", lines: [{ productId: product.id, quantity: "150" }] };

    await expect(createBill(owner, { ...draft, idempotencyKey: "bill-key-0002" })).rejects.toMatchObject({ code: "SHORTFALL_NOT_CONFIRMED" });
    expect(await prisma.bill.count()).toBe(0);

    const bill = await createBill(owner, { ...draft, idempotencyKey: "bill-key-0003", confirmShortfall: true });
    expect(bill.invoiceNumber.endsWith("/00001")).toBe(true); // the refused attempt did not burn a number
    expect(bill.lineItems[0].shortfallQuantity?.toString()).toBe("50");
    expect(await stock(product.id)).toBe("-50.00");
  });

  it("returns the original bill for a replayed key", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const input = { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "bill-key-0004", lines: [{ productId: product.id, quantity: "10" }] };
    const first = await createBill(owner, input);
    const second = await createBill(owner, input);
    expect(second.id).toBe(first.id);
    expect(await prisma.bill.count()).toBe(1);
    expect(await stock(product.id)).toBe("90.00");
  });

  it("survives a double-tapped Finalize (two identical requests at once)", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const input = { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "bill-key-0005", lines: [{ productId: product.id, quantity: "10" }] };
    const [a, b] = await Promise.all([createBill(owner, input), createBill(owner, input)]);
    expect(a.id).toBe(b.id);
    expect(await prisma.bill.count()).toBe(1);
    expect(await stock(product.id)).toBe("90.00");

    const next = await createBill(owner, { ...input, idempotencyKey: "bill-key-0006" });
    expect(next.invoiceNumber.endsWith("/00002")).toBe(true); // still gapless
  });

  it("applies two different concurrent bills exactly once each", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const base = { customerId: customer.id, placeOfSupply: "21" };
    const [a, b] = await Promise.all([
      createBill(owner, { ...base, idempotencyKey: "bill-key-0007", lines: [{ productId: product.id, quantity: "10" }] }),
      createBill(owner, { ...base, idempotencyKey: "bill-key-0008", lines: [{ productId: product.id, quantity: "15" }] }),
    ]);
    expect(a.invoiceNumber).not.toBe(b.invoiceNumber);
    expect(await stock(product.id)).toBe("75.00");
  });

  it("records payment received at billing, but not more than the total", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    const base = { customerId: customer.id, placeOfSupply: "21", lines: [{ productId: product.id, quantity: "10" }] };
    const bill = await createBill(owner, { ...base, idempotencyKey: "bill-key-0009", initialPayment: { amount: "500", method: "UPI" } });
    expect((await prisma.paymentLogEntry.findFirstOrThrow({ where: { billId: bill.id } })).amount.toString()).toBe("500");
    await expect(createBill(owner, { ...base, idempotencyKey: "bill-key-0010", initialPayment: { amount: "5000", method: "CASH" } }))
      .rejects.toThrow(ValidationError);
  });

  it("queues e-invoice submission only for registered (B2B) customers when e-invoicing applies", async () => {
    const { owner, customer: b2c, product } = await setupBillingWorld();
    await makeBusinessProfile({ einvoicingApplicable: true });
    const b2b = await makeCustomer({ gstin: ODISHA_CUSTOMER_GSTIN });
    const line = [{ productId: product.id, quantity: "1" }];

    const b2cBill = await createBill(owner, { customerId: b2c.id, placeOfSupply: "21", idempotencyKey: "bill-key-0011", lines: line });
    const b2bBill = await createBill(owner, { customerId: b2b.id, placeOfSupply: "21", idempotencyKey: "bill-key-0012", lines: line });
    expect(await prisma.irpSubmission.findUnique({ where: { billId: b2cBill.id } })).toBeNull();
    expect((await prisma.irpSubmission.findUniqueOrThrow({ where: { billId: b2bBill.id } })).status).toBe("PENDING");
  });

  it("rejects workers", async () => {
    const { worker, customer, product } = await setupBillingWorld();
    await expect(createBill(worker, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "bill-key-0013", lines: [{ productId: product.id, quantity: "1" }] }))
      .rejects.toThrow(ForbiddenError);
  });
});
