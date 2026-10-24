import type Decimal from "decimal.js";
import type { BillableProduct } from "@/components/product-picker";
import { linePieces, piecesPerUnit, type Line } from "@/components/bill-lines";
import { D, round2 } from "@/lib/money";
import { rateFor, type RateTier } from "@/lib/rates";

/** The rate for ONE PIECE used on a line: the typed rate (typed per patty/dozen/piece), else the chosen A/B/C rate. */
export function lineRate(product: BillableProduct, line: Pick<Line, "rateChoice" | "unitPrice" | "unit">, billTier: RateTier): Decimal {
  const typed = line.unitPrice.trim();
  if (typed !== "") {
    try { return D(typed.replace(/,/g, "")).div(piecesPerUnit(line.unit)).toDecimalPlaces(4); } catch { /* an unfinished number counts as the standard rate until it is complete */ }
  }
  return rateFor(product, line.rateChoice === "bill" ? billTier : (line.rateChoice as RateTier));
}

/** The same rate as shown to the person: per patty, per dozen or per piece, whichever unit the line is in. */
export function rateInUnit(product: BillableProduct, line: Pick<Line, "rateChoice" | "unitPrice" | "unit">, billTier: RateTier): Decimal {
  return lineRate(product, line, billTier).times(piecesPerUnit(line.unit));
}

export type LineMoney = { ex: Decimal; inc: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal };

/** GST on an amount: CGST + SGST halves within the state, IGST between states (the same split the server makes). */
export function gstOn(ex: Decimal, gstRate: Decimal, interState: boolean): LineMoney {
  if (interState) {
    const igst = round2(ex.times(gstRate).div(100));
    return { ex, inc: ex.plus(igst), cgst: D(0), sgst: D(0), igst };
  }
  const half = round2(ex.times(gstRate).div(200));
  return { ex, inc: ex.plus(half).plus(half), cgst: half, sgst: half, igst: D(0) };
}

/**
 * What a line comes to, worked out right here so it shows the moment quantity and rate are filled, before a customer is
 * even chosen: rate x quantity (the Total Amount), plus the GST on it. Once the server has priced the bill its own figures
 * are shown instead.
 */
export function estimateLine(product: BillableProduct | undefined, line: Line | undefined, billTier: RateTier, interState = false): LineMoney | null {
  if (!product || !line) return null;
  const pieces = D(linePieces(line, product));
  if (!pieces.greaterThan(0)) return null;
  return gstOn(round2(pieces.times(lineRate(product, line, billTier))), D(product.gstRate), interState);
}

/** A charge (carton, crate, freight) with GST at the highest rate among the items, as the server does by default. */
export function estimateCharge(amount: string, highestGst: Decimal, interState = false): LineMoney | null {
  const text = amount.trim();
  if (text === "") return null;
  try {
    const ex = round2(D(text));
    return ex.greaterThan(0) ? gstOn(ex, highestGst, interState) : null;
  } catch {
    return null;
  }
}
