import type { BillableProduct } from "@/components/product-picker";
import { toPieces } from "@/lib/cartons";

/** One row of a bill being typed. Shared by the card layout and the Excel-sheet layout so switching never loses anything. */
export type Line = { rowId: number; productId: string; cartons: string; loosePieces: string; unitPrice: string; discountAmount: string };
export type ChargeKey = "CARTON" | "CRATE" | "FREIGHT";
export type Charges = Record<ChargeKey, string>;

export const CHARGE_FIELDS: { kind: ChargeKey; label: string }[] = [
  { kind: "CARTON", label: "Total carton charges" }, { kind: "CRATE", label: "Extra crate charges" }, { kind: "FREIGHT", label: "Freight charges" },
];

let nextRowId = 1;
export const blankLine = (productId = ""): Line => ({ rowId: nextRowId++, productId, cartons: "", loosePieces: "", unitPrice: "", discountAmount: "" });

/** Total pieces on a line; 0 while the fields are empty or not yet a valid number. */
export function linePieces(line: Line | undefined, product: BillableProduct | undefined): string {
  if (!line || !product) return "0";
  return toPieces(line.cartons, line.loosePieces, product.qtyPerCarton);
}
