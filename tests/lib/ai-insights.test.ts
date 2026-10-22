import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { buildInsightsDigest } from "@/domain/ai-insights";
import type { getDuesAgeing, getSalesReport, getStockMovementReport } from "@/domain/sales-reports";
import { AGEING_BUCKETS } from "@/domain/sales-reports";

const D = (v: number | string) => new Decimal(v);

type Sales = Awaited<ReturnType<typeof getSalesReport>>;
type Ageing = Awaited<ReturnType<typeof getDuesAgeing>>;
type Movement = Awaited<ReturnType<typeof getStockMovementReport>>;

function fakeSales(opts: { billCount?: number; empty?: boolean } = {}): Sales {
  return {
    from: "2026-10-01", to: "2026-10-22",
    billCount: opts.billCount ?? 34,
    taxable: D(100000), cgst: D(2500), sgst: D(2500), igst: D(0), roundOff: D(0), billed: D(105000),
    creditNoteCount: 1, credited: D(1050), netSales: D(103950),
    byDay: opts.empty ? [] : [
      { day: "2026-10-18", bills: 5, total: D(30000) },
      { day: "2026-10-02", bills: 2, total: D(8000) },
    ],
    byProduct: opts.empty ? [] : [
      { productId: "p1", name: "Rose candle", quantity: D(600), taxable: D(57000), total: D(60000) },
      { productId: "p2", name: "Birthday candles", quantity: D(300), taxable: D(28000), total: D(30000) },
    ],
    byCustomer: opts.empty ? [] : [{ customerId: "c1", name: "Sharma Traders", bills: 12, total: D(50000) }],
  } as unknown as Sales;
}

function fakeAgeing(overrides: Partial<Record<(typeof AGEING_BUCKETS)[number], number>> = {}): Ageing {
  const totals = {
    "0-30": D(overrides["0-30"] ?? 1000),
    "31-60": D(overrides["31-60"] ?? 0),
    "61-90": D(overrides["61-90"] ?? 0),
    "90+": D(overrides["90+"] ?? 0),
  } satisfies Record<(typeof AGEING_BUCKETS)[number], Decimal>;
  const grandTotal = Object.values(totals).reduce((a, b) => a.plus(b), D(0));
  return {
    totals,
    grandTotal,
    // The real query lists only customers with outstanding bills.
    customers: grandTotal.gt(0)
      ? [{ customerId: "c1", name: "Sharma Traders", buckets: totals, total: grandTotal }]
      : [],
  } as unknown as Ageing;
}

function fakeMovement(items: { name: string; qtyPerCarton: number; sold: number; produced: number; closing: number }[]): Movement {
  return {
    from: "2026-10-01", to: "2026-10-22",
    items: items.map((i, index) => ({
      id: `p${index}`, name: i.name, qtyPerCarton: i.qtyPerCarton,
      opening: D(1000), produced: D(i.produced), sold: D(i.sold), returned: D(0), adjusted: D(0), closing: D(i.closing),
    })),
  } as unknown as Movement;
}

describe("buildInsightsDigest", () => {
  it("keeps the period, totals, top items and top customers", () => {
    const digest = buildInsightsDigest(fakeSales(), fakeAgeing(), fakeMovement([]));
    expect(digest).toContain("Period 2026-10-01 to 2026-10-22");
    expect(digest).toContain("34 invoices");
    expect(digest).toContain("Rose candle");
    expect(digest).toContain("600");
    expect(digest).toContain("Sharma Traders");
    expect(digest).toContain("net sales ₹1,03,950.00");
  });

  it("names the busiest day by amount, not by order of appearance", () => {
    const digest = buildInsightsDigest(fakeSales(), fakeAgeing(), fakeMovement([]));
    expect(digest).toContain("Busiest days: 2026-10-18");
    expect(digest.indexOf("2026-10-18")).toBeLessThan(digest.indexOf("2026-10-02"));
  });

  it("marks the oldest unpaid bucket of each due customer", () => {
    const digest = buildInsightsDigest(fakeSales(), fakeAgeing({ "90+": 250 }), fakeMovement([]));
    expect(digest).toContain("90+ days");
    expect(digest).toMatch(/oldest 90\+ days/);
  });

  it("lists items below one carton", () => {
    const digest = buildInsightsDigest(fakeSales(), fakeAgeing(), fakeMovement([{ name: "Masjid candle", qtyPerCarton: 50, sold: 480, produced: 500, closing: 41 }]));
    expect(digest).toContain("Masjid candle");
    expect(digest).toContain("Below one carton now: Masjid candle");
    expect(digest).toContain("1 carton = 50");
  });

  it("does not invent lines for empty sections", () => {
    const digest = buildInsightsDigest(fakeSales({ billCount: 0, empty: true }), fakeAgeing({ "0-30": 0 }), fakeMovement([]));
    expect(digest).not.toContain("Top items");
    expect(digest).not.toContain("Top customers");
    expect(digest).not.toContain("Busiest days");
    expect(digest).not.toContain("Biggest dues");
    expect(digest).toContain("0 invoices");
  });
});
