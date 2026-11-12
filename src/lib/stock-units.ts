import { D } from "@/lib/money";

export const STOCK_UNITS = ["PIECE", "PATTY", "DOZEN"] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];
export const STOCK_MODES = ["CARTONS_AND_UNITS", "UNIT_ONLY"] as const;
export type StockMode = (typeof STOCK_MODES)[number];

export const STOCK_UNIT_FACTOR: Record<StockUnit, number> = {
  PIECE: 1,
  PATTY: 30,
  DOZEN: 12,
};

export function stockUnitLabel(unit: StockUnit, quantity = 1): string {
  if (unit === "PIECE") return quantity === 1 ? "piece" : "pieces";
  if (unit === "PATTY") return quantity === 1 ? "patty" : "patties";
  return quantity === 1 ? "dozen" : "dozens";
}

export function cartonQuantityInUnit(piecesPerCarton: number, unit: StockUnit): number {
  return piecesPerCarton / STOCK_UNIT_FACTOR[unit];
}

export function cartonQuantityText(piecesPerCarton: number, unit: StockUnit): string {
  return String(Number(cartonQuantityInUnit(piecesPerCarton, unit).toFixed(2)));
}

export function stockQuantityToPieces(quantity: string, unit: StockUnit): string {
  const raw = quantity.trim();
  if (!raw) return "0";
  try { return D(raw).times(STOCK_UNIT_FACTOR[unit]).toString(); }
  catch { return "0"; }
}
