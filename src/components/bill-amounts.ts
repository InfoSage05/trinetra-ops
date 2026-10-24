import type Decimal from "decimal.js";
import type { BillableProduct } from "@/components/product-picker";
import { linePieces, type Line } from "@/components/bill-lines";
import { D, round2 } from "@/lib/money";
import { rateFor, type RateTier } from "@/lib/rates";

/** The rate per piece used on a line: a typed rate, else the chosen A/B/C rate, else the bill's rate type. */
export function lineRate(product: BillableProduct, line: Pick<Line, "rateChoice" | "unitPrice">, billTier: RateTier): Decimal {
  const typed = line.unitPrice.trim();
  if (typed !== "") {
    try { return D(typed); } catch { /* an unfinished number counts as the standard rate until it is complete */ }
  }
  return rateFor(product, line.rateChoice === "bill" ? billTier : (line.rateChoice as RateTier));
}

export type LineMoney = { ex: Decimal; inc: Decimal };

/**
 * What a line comes to, worked out right here so it shows the moment quantity and rate are filled, before a customer is
 * even chosen: pieces x rate, then with GST added. (Once the server has priced the bill its own figures are shown.)
 */
export function estimateLine(product: BillableProduct | undefined, line: Line | undefined, billTier: RateTier): LineMoney | null {
  if (!product || !line) return null;
  const pieces = D(linePieces(line, product));
  if (!pieces.greaterThan(0)) return null;
  const ex = round2(pieces.times(lineRate(product, line, billTier)));
  return { ex, inc: ex.plus(round2(ex.times(D(product.gstRate)).div(100))) };
}

/** A charge (carton, crate, freight) with GST at the highest rate among the items, as the server does by default. */
export function estimateCharge(amount: string, highestGst: Decimal): LineMoney | null {
  const text = amount.trim();
  if (text === "") return null;
  try {
    const ex = round2(D(text));
    if (!ex.greaterThan(0)) return null;
    return { ex, inc: ex.plus(round2(ex.times(highestGst).div(100))) };
  } catch {
    return null;
  }
}
