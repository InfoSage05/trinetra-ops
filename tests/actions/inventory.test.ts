import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getCurrentStock } from "@/domain/stock";
import {
  adjustStockAction, approveStockCountAction, importOpeningStockAction, previewOpeningStockAction,
  recordProductionAction, submitStockCountAction,
} from "@/actions/inventory";
import { resetDb } from "../helpers/db";
import { makeProduct, makeUser } from "../helpers/factories";

vi.mock("@/lib/session", () => ({ getSession: vi.fn(), setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

const stock = async (id: string) => (await getCurrentStock(prisma, id)).toFixed(2);

describe("inventory actions", () => {
  beforeEach(resetDb);

  it("lets workers record production and submit counts, but not correct stock", async () => {
    const p = await makeProduct();
    vi.mocked(getSession).mockResolvedValue(await makeUser("WORKER"));
    expect(await recordProductionAction({ productId: p.id, quantity: "40", idempotencyKey: "inv-prod-0001" })).toMatchObject({ ok: true });
    expect(await submitStockCountAction({ productId: p.id, countedQuantity: "38" })).toMatchObject({ ok: true });
    expect(await adjustStockAction({ productId: p.id, quantityDelta: "-1", reason: "x", idempotencyKey: "inv-adj-0001" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await stock(p.id)).toBe("40.00");
  });

  it("lets the owner approve a count", async () => {
    const p = await makeProduct();
    const owner = await makeUser("OWNER");
    vi.mocked(getSession).mockResolvedValue(owner);
    await recordProductionAction({ productId: p.id, quantity: "40", idempotencyKey: "inv-prod-0002" });
    const count = await submitStockCountAction({ productId: p.id, countedQuantity: "37" });
    expect(count.ok).toBe(true);
    if (count.ok) await approveStockCountAction({ stockCountId: count.data.id });
    expect(await stock(p.id)).toBe("37.00");
  });

  it("previews and imports opening stock from a CSV upload", async () => {
    vi.mocked(getSession).mockResolvedValue(await makeUser("OWNER"));
    const p = await makeProduct({ sku: "LJC-01" });
    const form = () => {
      const f = new FormData();
      f.set("file", new File(["SKU,Qty\nLJC-01,120\nNOPE,4\n"], "opening.csv"));
      f.set("importBatchId", "cutover-test");
      return f;
    };
    const preview = await previewOpeningStockAction(form());
    expect(preview).toMatchObject({ ok: true, data: { ready: [{ sku: "LJC-01" }], problems: [{ rowNumber: 3 }] } });
    expect(await importOpeningStockAction(form())).toMatchObject({ ok: false, code: "VALIDATION" });

    const clean = new FormData();
    clean.set("file", new File(["SKU,Qty\nLJC-01,120\n"], "opening.csv"));
    clean.set("importBatchId", "cutover-test");
    expect(await importOpeningStockAction(clean)).toMatchObject({ ok: true, data: { imported: 1 } });
    expect(await stock(p.id)).toBe("120.00");
  });
});
