"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setCartonSizeAction } from "@/actions/products";
import { callAction } from "@/lib/client/call-action";

/** "1 carton = [24] pcs": lets the owner say how many pieces make one carton for this item, right beside the stock. */
export function CartonSize({ id, name, value, unit, editable }: { id: string; name: string; value: number; unit: string; editable: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const changed = text.trim() !== String(value);

  if (!editable) return <span>1 carton = {value} {unit}</span>;

  async function save() {
    setBusy(true);
    const ok = await callAction(setCartonSizeAction({ id, qtyPerCarton: text }), { success: `Saved: 1 carton = ${text.trim()} ${unit}` });
    setBusy(false);
    if (ok) router.refresh();
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      1 carton =
      <input
        aria-label={`Pieces in one carton of ${name}`} inputMode="numeric" value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && changed && !busy) void save(); }}
        className={`h-8 w-16 rounded-md border bg-background px-2 text-center text-foreground ${value === 1 && !changed ? "border-amber-500" : ""}`}
      />
      {unit}
      {changed && <Button size="sm" className="h-8" disabled={busy} onClick={save}>Save</Button>}
      {value === 1 && !changed && <span className="text-amber-600">not set yet</span>}
    </span>
  );
}
