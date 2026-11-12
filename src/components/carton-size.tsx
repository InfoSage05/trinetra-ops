"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setCartonSizeAction } from "@/actions/products";
import { callAction } from "@/lib/client/call-action";
import { PATTY_PIECES } from "@/lib/units";

/** Lets the owner set the number of 30-piece patties in each carton for this item. */
export function CartonSize({ id, name, value, unit, editable }: { id: string; name: string; value: number; unit: string; editable: boolean }) {
  const router = useRouter();
  const legacyPieces = value > 1 && value % PATTY_PIECES !== 0;
  const currentPatties = value > 1 && value % PATTY_PIECES === 0 ? value / PATTY_PIECES : "";
  const [text, setText] = useState(String(currentPatties));
  const [busy, setBusy] = useState(false);
  const changed = legacyPieces ? text.trim() !== "" : text.trim() !== String(currentPatties);

  if (!editable) return <span>{legacyPieces ? `1 carton = ${value} ${unit}` : `1 carton = ${currentPatties || "not set"} ${currentPatties ? "patty" : "yet"}`}</span>;

  async function save() {
    setBusy(true);
    const patties = Number(text.trim());
    const ok = await callAction(setCartonSizeAction({ id, qtyPerCarton: String(patties * PATTY_PIECES) }), { success: `Saved: 1 carton = ${text.trim()} patty` });
    setBusy(false);
    if (ok) router.refresh();
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      1 carton =
      <input
        aria-label={`Patty in one carton of ${name}`} inputMode="numeric" value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && changed && !busy) void save(); }}
        className={`h-8 w-16 rounded-lg border bg-card px-2 text-center text-foreground ${value === 1 && !changed ? "border-warning" : ""}`}
      />
      patty
      {legacyPieces && <span className="text-xs text-muted-foreground">(currently {value} {unit})</span>}
      {changed && Number.isInteger(Number(text)) && Number(text) > 0 && <Button size="sm" className="h-8" disabled={busy} onClick={save}>Save</Button>}
      {(value === 1 || legacyPieces) && !changed && <span className="text-warning-foreground">{value === 1 ? "not set yet" : "set in pieces"}</span>}
    </span>
  );
}
