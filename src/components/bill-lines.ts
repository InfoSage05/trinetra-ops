import type { BillableProduct } from "@/components/product-picker";
import { D } from "@/lib/money";

/** How a dealer counts an order: loose pieces, whole cartons, or dozens (12 pieces). */
export type QtyUnit = "carton" | "dozen" | "piece";
export const QTY_UNITS: { value: QtyUnit; label: string }[] = [
  { value: "carton", label: "Cartons" }, { value: "dozen", label: "Dozens" }, { value: "piece", label: "Pieces" },
];

/** One row of a bill being typed. Shared by the card layout and the Excel-sheet layout so switching never loses anything. */
export type Line = { rowId: number; productId: string; qty: string; unit: QtyUnit; unitPrice: string; discountAmount: string };
export type ChargeKey = "CARTON" | "CRATE" | "FREIGHT";
export type Charges = Record<ChargeKey, string>;

export const CHARGE_FIELDS: { kind: ChargeKey; label: string }[] = [
  { kind: "CARTON", label: "Total carton charges" }, { kind: "CRATE", label: "Extra crate charges" }, { kind: "FREIGHT", label: "Freight charges" },
];

let nextRowId = 1;
// New rows start in the unit last used, so a dealer who always orders in dozens does not have to switch every row.
let lastUnit: QtyUnit = "carton";
export const rememberUnit = (unit: QtyUnit) => { lastUnit = unit; };
export const blankLine = (productId = ""): Line => ({ rowId: nextRowId++, productId, qty: "", unit: lastUnit, unitPrice: "", discountAmount: "" });

/** Pieces in one of the chosen unit for this item. */
export function piecesPerUnit(unit: QtyUnit, qtyPerCarton: number): number {
  return unit === "piece" ? 1 : unit === "dozen" ? 12 : qtyPerCarton;
}

/** Total pieces on a line; 0 while the fields are empty or not yet a valid number. */
export function linePieces(line: Line | undefined, product: BillableProduct | undefined): string {
  if (!line || !product || line.qty.trim() === "") return "0";
  try {
    return D(line.qty.trim()).times(piecesPerUnit(line.unit, product.qtyPerCarton)).toString();
  } catch {
    return "0";
  }
}

/** A quantity in pieces shown the way it was probably ordered: whole cartons when it divides evenly, else pieces. */
export function fromPieces(pieces: string, qtyPerCarton: number): { qty: string; unit: QtyUnit } {
  const p = D(pieces);
  return qtyPerCarton > 1 && p.mod(qtyPerCarton).isZero() ? { qty: p.div(qtyPerCarton).toString(), unit: "carton" } : { qty: p.toString(), unit: "piece" };
}
