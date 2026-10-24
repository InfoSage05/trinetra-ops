import type Decimal from "decimal.js";
import type { BillableProduct } from "@/components/product-picker";
import { D } from "@/lib/money";
import { DOZEN_PIECES, PATTY_PIECES } from "@/lib/units";

/**
 * How a dealer counts an order: patty (30 pieces), dozens (12 pieces) or loose pieces.
 * Cartons are entered in their own column: a carton is a number of patty, and that number differs from item to item.
 */
export type QtyUnit = "patty" | "dozen" | "piece";
export const QTY_UNITS: { value: QtyUnit; label: string }[] = [
  { value: "patty", label: "Patty" }, { value: "dozen", label: "Dozens" }, { value: "piece", label: "Pieces" },
];

/** Which rate a line uses: the bill's rate type, one of the item's three rates, or a number typed in (unitPrice). */
export type RateChoice = "bill" | "A" | "B" | "C";

/**
 * One row of a bill being typed. Shared by the card layout and the Excel-sheet layout so switching never loses anything.
 * `cartons` and `pattyPerCarton` are typed by hand; `pattyPerCarton` empty means "the item's own carton size".
 */
export type Line = {
  rowId: number; productId: string; qty: string; unit: QtyUnit; cartons: string; pattyPerCarton: string;
  rateChoice: RateChoice; unitPrice: string; discountAmount: string;
};
export type ChargeKey = "CARTON" | "CRATE" | "FREIGHT";
export type Charges = Record<ChargeKey, string>;

export const CHARGE_FIELDS: { kind: ChargeKey; label: string }[] = [
  { kind: "CARTON", label: "Total carton charges" }, { kind: "CRATE", label: "Extra crate charges" }, { kind: "FREIGHT", label: "Freight charges" },
];

let nextRowId = 1;
// New rows start in the unit last used, so a dealer who always orders in dozens does not have to switch every row.
let lastUnit: QtyUnit = "patty";
export const rememberUnit = (unit: QtyUnit) => { lastUnit = unit; };
export const blankLine = (productId = ""): Line => ({
  rowId: nextRowId++, productId, qty: "", unit: lastUnit, cartons: "", pattyPerCarton: "", rateChoice: "bill", unitPrice: "", discountAmount: "",
});

export function piecesPerUnit(unit: QtyUnit): number {
  return unit === "piece" ? 1 : unit === "dozen" ? DOZEN_PIECES : PATTY_PIECES;
}

const asDecimal = (text: string): Decimal | null => {
  if (text.trim() === "") return null;
  try { return D(text.trim().replace(/,/g, "")); } catch { return null; }
};

/** Patty in one carton for this line: the typed number, else the item's own carton size. */
export function pattyPerCarton(line: Pick<Line, "pattyPerCarton">, product: BillableProduct | undefined): Decimal {
  const typed = asDecimal(line.pattyPerCarton);
  if (typed && typed.greaterThan(0)) return typed;
  return D(product?.qtyPerCarton ?? 1).div(PATTY_PIECES);
}

/** Pieces in one carton for this line. */
export function cartonPieces(line: Pick<Line, "pattyPerCarton">, product: BillableProduct | undefined): Decimal {
  return pattyPerCarton(line, product).times(PATTY_PIECES);
}

/** Total pieces on a line; 0 while the fields are empty or not yet a valid number. */
export function linePieces(line: Line | undefined, product: BillableProduct | undefined): string {
  if (!line || !product) return "0";
  const qty = asDecimal(line.qty);
  if (!qty) return "0";
  return qty.times(piecesPerUnit(line.unit)).toString();
}

const show = (d: Decimal) => d.toDecimalPlaces(4).toString();

/**
 * Applies an edit to a row and keeps the related boxes in step, so any of them can be typed by hand:
 *  - typing Cartons works out the quantity (cartons x patty per carton, in patty);
 *  - typing Patty-per-carton keeps the cartons the same and works out the quantity again;
 *  - typing Quantity or Unit works out how many cartons that is.
 */
export function applyLineEdit(line: Line, patch: Partial<Line>, product: BillableProduct | undefined): Line {
  const next = { ...line, ...patch };
  if ("unit" in patch && patch.unit !== line.unit && line.unitPrice.trim() !== "" && !("unitPrice" in patch)) {
    const typed = asDecimal(line.unitPrice);
    if (typed) next.unitPrice = typed.div(piecesPerUnit(line.unit)).times(piecesPerUnit(next.unit)).toDecimalPlaces(4).toString();
  }
  const typedCartons = "cartons" in patch;
  const typedCarton = "pattyPerCarton" in patch;
  if (!product) return next;

  if (typedCartons || typedCarton) {
    const cartons = asDecimal(next.cartons);
    if (cartons && cartons.greaterThanOrEqualTo(0)) return { ...next, unit: "patty", qty: show(cartons.times(pattyPerCarton(next, product))) };
    return typedCartons ? { ...next, qty: "" } : next;
  }
  if ("qty" in patch || "unit" in patch || "productId" in patch) {
    const pieces = D(linePieces(next, product));
    const perCarton = cartonPieces(next, product);
    return { ...next, cartons: pieces.greaterThan(0) && perCarton.greaterThan(0) ? show(pieces.div(perCarton)) : "" };
  }
  return next;
}

/** A quantity in pieces shown the way it was probably ordered: whole patty when it divides evenly, else pieces. */
export function fromPieces(pieces: string, product: BillableProduct): Pick<Line, "qty" | "unit" | "cartons"> {
  const p = D(pieces);
  const perCarton = D(product.qtyPerCarton);
  const cartons = p.greaterThan(0) && perCarton.greaterThan(0) ? show(p.div(perCarton)) : "";
  return p.mod(PATTY_PIECES).isZero() ? { qty: show(p.div(PATTY_PIECES)), unit: "patty", cartons } : { qty: p.toString(), unit: "piece", cartons };
}
