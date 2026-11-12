import type Decimal from "decimal.js";
import type { BillableProduct } from "@/components/product-picker";
import { D } from "@/lib/money";
import { DOZEN_PIECES, PATTY_PIECES } from "@/lib/units";
import type { StockUnit } from "@/lib/stock-units";

/** Units dealers use when stating the quantity packed in one carton. */
export type QtyUnit = "patty" | "dozen" | "piece";
export const QTY_UNITS: { value: QtyUnit; label: string }[] = [
  { value: "patty", label: "Patty" }, { value: "dozen", label: "Dozens" }, { value: "piece", label: "Pieces" },
];

/** Which rate a line uses: the bill's rate type, one of the item's three rates, or a number typed in (unitPrice). */
export type RateChoice = "bill" | "A" | "B" | "C";

/**
 * One row of a bill being typed. Cartons are always the manually entered count.
 * Quantity is derived as cartons × quantityPerCarton, expressed in `unit`.
 */
export type Line = {
  rowId: number; productId: string; qty: string; unit: QtyUnit; cartons: string; quantityPerCarton: string;
  rateChoice: RateChoice; unitPrice: string; discountAmount: string;
};
export type ChargeKey = "CARTON" | "CRATE" | "FREIGHT";
export type Charges = Record<ChargeKey, string>;

export const CHARGE_FIELDS: { kind: ChargeKey; label: string }[] = [
  { kind: "CARTON", label: "Total carton charges" }, { kind: "CRATE", label: "Extra crate charges" }, { kind: "FREIGHT", label: "Freight charges" },
];

let nextRowId = 1;
let lastUnit: QtyUnit = "patty";
export const rememberUnit = (unit: QtyUnit) => { lastUnit = unit; };
export const blankLine = (productId = ""): Line => ({
  rowId: nextRowId++, productId, qty: "", unit: lastUnit, cartons: "", quantityPerCarton: "", rateChoice: "bill", unitPrice: "", discountAmount: "",
});

export function piecesPerUnit(unit: QtyUnit): number {
  return unit === "piece" ? 1 : unit === "dozen" ? DOZEN_PIECES : PATTY_PIECES;
}

export function unitForStockUnit(unit: StockUnit): QtyUnit {
  return unit === "PIECE" ? "piece" : unit === "DOZEN" ? "dozen" : "patty";
}

const asDecimal = (text: string): Decimal | null => {
  if (text.trim() === "") return null;
  try { return D(text.trim().replace(/,/g, "")); } catch { return null; }
};

/** Quantity in the selected unit that the product's carton contains. */
export function quantityPerCarton(line: Pick<Line, "quantityPerCarton" | "unit">, product: BillableProduct | undefined): Decimal {
  const typed = asDecimal(line.quantityPerCarton);
  if (typed && typed.greaterThan(0)) return typed;
  return D(product?.qtyPerCarton ?? 0).div(piecesPerUnit(line.unit));
}

/** Pieces in one carton, using the unit selected for this line. */
export function cartonPieces(line: Pick<Line, "quantityPerCarton" | "unit">, product: BillableProduct | undefined): Decimal {
  return quantityPerCarton(line, product).times(piecesPerUnit(line.unit));
}

/** Total pieces on a line: the carton count is the source of truth. */
export function linePieces(line: Line | undefined, product: BillableProduct | undefined): string {
  if (!line || !product) return "0";
  const cartons = asDecimal(line.cartons);
  if (!cartons || !cartons.greaterThan(0)) return "0";
  return cartons.times(cartonPieces(line, product)).toString();
}

const show = (d: Decimal) => d.toDecimalPlaces(4).toString();

function calculatedQuantity(line: Line, product: BillableProduct | undefined): string {
  const cartons = asDecimal(line.cartons);
  if (!cartons || !cartons.greaterThanOrEqualTo(0)) return "";
  return show(cartons.times(quantityPerCarton(line, product)));
}

/**
 * Applies a row edit without ever deriving cartons from another field.
 * Changing unit converts the per-carton figure to the equivalent amount while preserving cartons and pieces.
 */
export function applyLineEdit(line: Line, patch: Partial<Line>, product: BillableProduct | undefined): Line {
  const next = { ...line, ...patch };
  if ("unit" in patch && patch.unit !== line.unit && line.quantityPerCarton.trim() !== "" && product) {
    next.quantityPerCarton = show(cartonPieces(line, product).div(piecesPerUnit(next.unit)));
  }
  if ("unit" in patch && patch.unit !== line.unit && line.unitPrice.trim() !== "" && !("unitPrice" in patch)) {
    const typed = asDecimal(line.unitPrice);
    if (typed) next.unitPrice = typed.div(piecesPerUnit(line.unit)).times(piecesPerUnit(next.unit)).toDecimalPlaces(4).toString();
  }

  if ("productId" in patch && patch.productId !== line.productId) {
    if (product && !("unit" in patch)) next.unit = unitForStockUnit(product.stockUnit);
    if (product) next.quantityPerCarton = show(D(product.qtyPerCarton).div(piecesPerUnit(next.unit)));
    else next.quantityPerCarton = "";
    if (!product) next.qty = "";
  }

  if (product && ("cartons" in patch || "quantityPerCarton" in patch || "unit" in patch || "productId" in patch)) {
    next.qty = calculatedQuantity(next, product);
  }
  return next;
}

/** Seed a bill line from an order's piece count, suggesting cartons using the item's configured carton size. */
export function fromPieces(pieces: string, product: BillableProduct): Pick<Line, "qty" | "unit" | "cartons" | "quantityPerCarton"> {
  const p = D(pieces);
  const unit = unitForStockUnit(product.stockUnit);
  const perCarton = D(product.qtyPerCarton).div(piecesPerUnit(unit));
  const cartons = p.greaterThan(0) && product.qtyPerCarton > 0 ? show(p.div(product.qtyPerCarton)) : "";
  return { qty: cartons ? show(D(cartons).times(perCarton)) : "", unit, cartons, quantityPerCarton: "" };
}
