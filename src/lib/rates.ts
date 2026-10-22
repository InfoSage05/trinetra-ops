import type Decimal from "decimal.js";
import { D } from "@/lib/money";

/**
 * Every item can carry three rates:
 *  A = big wholesalers who take a huge quantity (lowest),
 *  B = normal wholesalers who take a medium quantity (the item's standard rate),
 *  C = direct vendors who take a little, especially near Diwali (highest).
 * Rate B is the item's main price. A tier with no rate of its own uses Rate B.
 */
export const RATE_TIERS = ["A", "B", "C"] as const;
export type RateTier = (typeof RATE_TIERS)[number];

export const RATE_TIER_LABELS: Record<RateTier, string> = {
  A: "Rate A (big wholesalers)",
  B: "Rate B (normal wholesalers)",
  C: "Rate C (direct vendors)",
};

export type ItemRates = { unitPrice: string | number | Decimal; rateA?: string | number | Decimal | null; rateC?: string | number | Decimal | null };

/** The rate to use for an item at a tier. */
export function rateFor(item: ItemRates, tier: RateTier): Decimal {
  const own = tier === "A" ? item.rateA : tier === "C" ? item.rateC : null;
  return D(own !== null && own !== undefined && String(own) !== "" ? own : item.unitPrice);
}

export function isRateTier(value: unknown): value is RateTier {
  return value === "A" || value === "B" || value === "C";
}
