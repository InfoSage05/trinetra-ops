import { describe, it, expect, beforeEach, vi } from "vitest";
import { getSession } from "@/lib/session";
import { createBill } from "@/domain/billing";
import { recordPaymentAction, recordReturnAction } from "@/actions/bills";
import { resetDb } from "../helpers/db";
import { setupBillingWorld } from "../helpers/factories";

vi.mock("@/lib/session", () => ({ getSession: vi.fn(), setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

describe("bill actions", () => {
  beforeEach(resetDb);

  it("records a payment and a return through the UI actions", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    vi.mocked(getSession).mockResolvedValue(owner);
    const bill = await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "ui-bill-00000001", lines: [{ productId: product.id, quantity: "10" }] });

    expect(await recordPaymentAction({ billId: bill.id, amount: "500", method: "UPI", idempotencyKey: "ui-pay-00000001" })).toMatchObject({ ok: true, data: { amount: "500" } });
    expect(await recordReturnAction({ billId: bill.id, reason: "Damaged", restock: false, lines: [{ billLineItemId: bill.lineItems[0].id, quantity: "1" }], idempotencyKey: "ui-ret-00000001" }))
      .toMatchObject({ ok: true, data: { grandTotal: "177" } });
  });
});
