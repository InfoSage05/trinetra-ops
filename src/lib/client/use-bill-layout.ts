"use client";
import { useCallback, useSyncExternalStore } from "react";

export type BillLayout = "cards" | "sheet";
const KEY = "trinetra.billLayout";
const EVENT = "trinetra-bill-layout";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => { window.removeEventListener("storage", onChange); window.removeEventListener(EVENT, onChange); };
}

/** Remembers, on this device, whether bills are made as cards or as an Excel-style sheet. */
export function useBillLayout(): [BillLayout, (layout: BillLayout) => void] {
  const layout = useSyncExternalStore<BillLayout>(
    subscribe,
    () => (window.localStorage.getItem(KEY) === "sheet" ? "sheet" : "cards"),
    () => "cards"
  );
  const set = useCallback((next: BillLayout) => {
    window.localStorage.setItem(KEY, next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [layout, set];
}
