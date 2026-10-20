import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { listBillableProducts } from "@/domain/billing";
import { previewBillAction, createBillAction } from "@/actions/billing";
import { resetDb } from "../helpers/db";
import { setupBillingWorld } from "../helpers/factories";

vi.mock("@/lib/session", () => ({ getSession: vi.fn(), setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

describe("billing actions", () => {
  beforeEach(resetDb);

  it("lists billable products with price and live stock", async () => {
    const { owner, product } = await setupBillingWorld();
    const rows = await listBillableProducts(owner);
    expect(rows.find((r) => r.id === product.id)).toMatchObject({ name: product.name });
    expect(rows[0].stock.toFixed(2)).toBe("100.00");
  });

  it("returns a JSON-safe preview (Decimals as strings)", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    vi.mocked(getSession).mockResolvedValue(owner);
    const result = await previewBillAction({ customerId: customer.id, placeOfSupply: "21", lines: [{ productId: product.id, quantity: "10" }] });
    expect(result).toMatchObject({ ok: true, data: { grandTotal: "1770", hasShortfall: false } });
  });

  it("creates the bill once even if Save is pressed twice with the same key", async () => {
    const { owner, customer, product } = await setupBillingWorld();
    vi.mocked(getSession).mockResolvedValue(owner);
    const input = { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "ui-key-00000001", lines: [{ productId: product.id, quantity: "2" }] };
    const [a, b] = await Promise.all([createBillAction(input), createBillAction(input)]);
    expect(a.ok && b.ok && a.data.id === b.data.id).toBe(true);
    expect(await prisma.bill.count()).toBe(1);
  });

  it("tells the UI when a shortfall needs confirmation, and blocks workers", async () => {
    const { owner, worker, customer, product } = await setupBillingWorld();
    vi.mocked(getSession).mockResolvedValue(owner);
    const draft = { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "ui-key-00000002", lines: [{ productId: product.id, quantity: "500" }] };
    expect(await createBillAction(draft)).toMatchObject({ ok: false, code: "SHORTFALL_NOT_CONFIRMED" });

    vi.mocked(getSession).mockResolvedValue(worker);
    expect(await createBillAction({ ...draft, idempotencyKey: "ui-key-00000003" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});
