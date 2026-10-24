"use client";
import { useCallback, useSyncExternalStore } from "react";

const KEY = "trinetra.savePdfCopy";
const EVENT = "trinetra-save-copy";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => { window.removeEventListener("storage", onChange); window.removeEventListener(EVENT, onChange); };
}

/** Whether a PDF copy of each saved bill is also stored on this device. On unless it has been switched off. */
export function useSavePdfCopy(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => window.localStorage.getItem(KEY) !== "off", () => true);
  const set = useCallback((value: boolean) => {
    window.localStorage.setItem(KEY, value ? "on" : "off");
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [on, set];
}

/** Read at the moment of saving (outside React). */
export const savePdfCopyEnabled = () => typeof window !== "undefined" && window.localStorage.getItem(KEY) !== "off";
