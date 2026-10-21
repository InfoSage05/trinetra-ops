import Decimal from "decimal.js";
import { D, formatQuantity } from "@/lib/money";

/** Splits a piece count into whole cartons plus loose pieces (for non-negative counts). */
export function splitCartons(pieces: number | string, qtyPerCarton: number): { cartons: number; pieces: number } {
  const total = Math.max(0, Math.floor(Number(pieces)));
  const per = Math.max(1, qtyPerCarton);
  return { cartons: Math.floor(total / per), pieces: total % per };
}

/** Cartons (may be fractional) + loose pieces → total pieces, as a string. Empty fields count as 0. */
export function toPieces(cartons: string, loosePieces: string, qtyPerCarton: number): string {
  const c = cartons.trim() === "" ? new Decimal(0) : D(cartons);
  const p = loosePieces.trim() === "" ? new Decimal(0) : D(loosePieces);
  return c.times(qtyPerCarton).plus(p).toString();
}

/** "3 cartons + 5 pcs (41 pcs)" — how stock is shown to people who think in cartons. */
export function describeStock(pieces: number | string, qtyPerCarton: number): string {
  const n = Number(pieces);
  if (n < 0) return `${formatQuantity(pieces)} pcs (oversold)`;
  const { cartons, pieces: loose } = splitCartons(n, qtyPerCarton);
  if (qtyPerCarton <= 1 || cartons === 0) return `${formatQuantity(pieces)} pcs`;
  const cartonText = `${cartons} ${cartons === 1 ? "carton" : "cartons"}`;
  return loose > 0 ? `${cartonText} + ${loose} pcs (${formatQuantity(pieces)} pcs)` : `${cartonText} (${formatQuantity(pieces)} pcs)`;
}
