import Decimal from "decimal.js";
import { D, formatQuantity } from "@/lib/money";
import { STOCK_UNIT_FACTOR, stockUnitLabel, stockQuantityToPieces, type StockMode, type StockUnit } from "@/lib/stock-units";

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

/** Cartons + loose stock units → the ledger's base piece quantity. */
export function cartonsAndUnitToPieces(cartons: string, looseQuantity: string, qtyPerCarton: number, stockUnit: StockUnit): string {
  return toPieces(cartons, multiplyUnit(looseQuantity, STOCK_UNIT_FACTOR[stockUnit]), qtyPerCarton);
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

/** Shows factory stock in cartons and the item's chosen loose unit, with any final pieces visible. */
export function describeStockInUnit(pieces: number | string, qtyPerCarton: number, stockUnit: StockUnit, stockMode: StockMode = "CARTONS_AND_UNITS"): string {
  const n = Number(pieces);
  if (n < 0) return `${formatQuantity(pieces)} pcs (oversold)`;
  if (stockMode === "UNIT_ONLY") {
    const quantity = n / STOCK_UNIT_FACTOR[stockUnit];
    const text = `${formatQuantity(quantity)} ${stockUnitLabel(stockUnit, quantity)}`;
    return stockUnit === "PIECE" ? text : `${text} (${formatQuantity(pieces)} pcs)`;
  }
  if (qtyPerCarton <= 1) return `${formatQuantity(pieces)} pcs`;
  const { cartons, pieces: remainder } = splitCartons(n, qtyPerCarton);
  const factor = STOCK_UNIT_FACTOR[stockUnit];
  const looseQuantity = Math.floor(remainder / factor);
  const loosePieces = remainder % factor;
  const parts = [
    ...(cartons > 0 ? [`${cartons} ${cartons === 1 ? "carton" : "cartons"}`] : []),
    ...(looseQuantity > 0 ? [`${looseQuantity} ${stockUnitLabel(stockUnit, looseQuantity)}`] : []),
    ...(loosePieces > 0 ? [`${loosePieces} pcs`] : []),
  ];
  return parts.length ? `${parts.join(" + ")} (${formatQuantity(pieces)} pcs)` : "0 pcs";
}

export function unitQuantityToPieces(quantity: string, stockUnit: StockUnit): string {
  return stockQuantityToPieces(quantity, stockUnit);
}

/** Backwards-compatible convenience for callers that explicitly need patty display. */
export function describeStockInPatty(pieces: number | string, qtyPerCarton: number): string {
  return describeStockInUnit(pieces, qtyPerCarton, "PATTY");
}

/** Backwards-compatible convenience for callers that explicitly enter patty. */
export function cartonsAndPattyToPieces(cartons: string, patties: string, qtyPerCarton: number): string {
  return cartonsAndUnitToPieces(cartons, patties, qtyPerCarton, "PATTY");
}
