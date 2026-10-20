"use client";
import { useCallback, useState } from "react";

// crypto.randomUUID only exists on HTTPS/localhost; getRandomValues works everywhere (e.g. phone on shop Wi-Fi).
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** One key per form instance. Call renew() only after the server confirmed success. */
export function useIdempotencyKey(): [string, () => void] {
  const [key, setKey] = useState(newIdempotencyKey);
  const renew = useCallback(() => setKey(newIdempotencyKey()), []);
  return [key, renew];
}
