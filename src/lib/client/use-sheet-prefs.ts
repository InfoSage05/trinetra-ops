"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { MAX_BILL_ITEMS } from "@/lib/limits";

/** How the Excel-sheet bill is shown on this device. zoom 0 means "fit the screen by itself". */
export type SheetPrefs = { zoom: number; wide: boolean; rows: number };
export const DEFAULT_SHEET_PREFS: SheetPrefs = { zoom: 0, wide: true, rows: 12 };
export const MIN_ZOOM = 50;
export const MAX_ZOOM = 150;

const KEY = "trinetra.sheetPrefs";
const EVENT = "trinetra-sheet-prefs";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => { window.removeEventListener("storage", onChange); window.removeEventListener(EVENT, onChange); };
}

function parse(raw: string): SheetPrefs {
  try {
    const v = JSON.parse(raw) as Partial<SheetPrefs>;
    const zoom = Number(v.zoom);
    const rows = Number(v.rows);
    return {
      zoom: zoom === 0 ? 0 : Number.isFinite(zoom) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom))) : DEFAULT_SHEET_PREFS.zoom,
      wide: typeof v.wide === "boolean" ? v.wide : DEFAULT_SHEET_PREFS.wide,
      rows: Number.isFinite(rows) ? Math.min(MAX_BILL_ITEMS, Math.max(6, Math.round(rows))) : DEFAULT_SHEET_PREFS.rows,
    };
  } catch {
    return DEFAULT_SHEET_PREFS;
  }
}

export function useSheetPrefs(): [SheetPrefs, (change: Partial<SheetPrefs>) => void] {
  const raw = useSyncExternalStore(subscribe, () => window.localStorage.getItem(KEY) ?? "", () => "");
  const prefs = useMemo(() => (raw ? parse(raw) : DEFAULT_SHEET_PREFS), [raw]);
  const set = useCallback((change: Partial<SheetPrefs>) => {
    const current = parse(window.localStorage.getItem(KEY) ?? "");
    window.localStorage.setItem(KEY, JSON.stringify({ ...current, ...change }));
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [prefs, set];
}
