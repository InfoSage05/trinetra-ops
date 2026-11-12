import Decimal from "decimal.js";
import { D, formatQuantity } from "@/lib/money";
import { PATTY_PIECES } from "@/lib/units";

/** Splits a piece count into whole cartons plus loose pieces (for non-negative counts). */
export function splitCartons(pieces: number | string, qtyPerCarton: number): { cartons: number; pieces: number } {
  const total = Math.max(0, Math.floor(Number(pieces)));
  const per = Math.max(1, qtyPerCarton);
  return { cartons: Math.floor(total / per), pieces: total % per };
}

/** Cartons (may be fractional) + loose pieces → total pieces, as a string. Empty or unreadable fields count as 0. */
export function toPieces(cartons: string, loosePieces: string, qtyPerCarton: number): string {
  try {
    const c = cartons.trim() === "" ? new Decimal(0) : D(cartons);
    const p = loosePieces.trim() === "" ? new Decimal(0) : D(loosePieces);
    return c.times(qtyPerCarton).plus(p).toString();
  } catch {
    return "0"; // half-typed text such as "1," is shown as 0 while typing; the server rejects it if it is submitted
  }
}

/** Cartons + loose patty → pieces. One patty is the established 30-piece dealer unit. */
export function cartonsAndPattyToPieces(cartons: string, patties: string, qtyPerCarton: number): string {
  return toPieces(cartons, multiplyUnit(patties, PATTY_PIECES), qtyPerCarton);
}

function multiplyUnit(value: string, multiplier: number): string {
  try { return (value.trim() === "" ? D(0) : D(value)).times(multiplier).toString(); }
  catch { return "0"; }
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

/** Shows factory stock in cartons and loose patty, with any final pieces kept visible. */
export function describeStockInPatty(pieces: number | string, qtyPerCarton: number): string {
  const n = Number(pieces);
  if (n < 0) return `${formatQuantity(pieces)} pcs (oversold)`;
  if (qtyPerCarton < PATTY_PIECES) return `${formatQuantity(pieces)} pcs`;
  const { cartons, pieces: remainder } = splitCartons(n, qtyPerCarton);
  const patties = Math.floor(remainder / PATTY_PIECES);
  const loosePieces = remainder % PATTY_PIECES;
  const parts = [
    ...(cartons > 0 ? [`${cartons} ${cartons === 1 ? "carton" : "cartons"}`] : []),
    ...(patties > 0 ? [`${patties} ${patties === 1 ? "patty" : "patties"}`] : []),
    ...(loosePieces > 0 ? [`${loosePieces} pcs`] : []),
  ];
  return parts.length ? `${parts.join(" + ")} (${formatQuantity(pieces)} pcs)` : "0 pcs";
}
