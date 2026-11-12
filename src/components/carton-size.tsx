"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setCartonSizeAction } from "@/actions/products";
import { callAction } from "@/lib/client/call-action";
import { STOCK_UNITS, STOCK_MODES, STOCK_UNIT_FACTOR, stockUnitLabel, cartonQuantityInUnit, cartonQuantityText, type StockMode, type StockUnit } from "@/lib/stock-units";

/** Lets the owner choose each item's carton contents and unit for loose stock. */
export function CartonSize({ id, name, value, stockUnit, stockMode, editable }: { id: string; name: string; value: number; stockUnit: StockUnit; stockMode: StockMode; editable: boolean }) {
  const router = useRouter();
  const unset = value === 1;
  const currentQuantity = cartonQuantityInUnit(value, stockUnit);
  const [text, setText] = useState(unset ? "" : cartonQuantityText(value, stockUnit));
  const [selectedUnit, setSelectedUnit] = useState<StockUnit>(stockUnit);
  const [selectedMode, setSelectedMode] = useState<StockMode>(stockMode);
  const [busy, setBusy] = useState(false);
  const changed = text.trim() !== (unset ? "" : cartonQuantityText(value, selectedUnit)) || selectedUnit !== stockUnit || selectedMode !== stockMode;

  if (!editable) return <span>{stockMode === "UNIT_ONLY" ? `Stock tracked in ${stockUnitLabel(stockUnit)} only` : unset ? "Carton size not set yet" : `1 carton = ${cartonQuantityText(value, stockUnit)} ${stockUnitLabel(stockUnit, currentQuantity)}`}</span>;

  async function save() {
    setBusy(true);
    const input = { id, stockUnit: selectedUnit, stockMode: selectedMode, ...(selectedMode === "CARTONS_AND_UNITS" ? { cartonQuantity: text.trim() } : {}) };
    const success = selectedMode === "UNIT_ONLY" ? `Saved: stock tracked in ${stockUnitLabel(selectedUnit)} only` : `Saved: 1 carton = ${text.trim()} ${stockUnitLabel(selectedUnit, Number(text.trim()))}`;
    const ok = await callAction(setCartonSizeAction(input), { success });
    setBusy(false);
    if (ok) router.refresh();
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {selectedMode === "CARTONS_AND_UNITS" ? <>
        1 carton =
        <input
          aria-label={`Stock units in one carton of ${name}`} inputMode="decimal" value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && changed && !busy) void save(); }}
          className={`h-8 w-16 rounded-lg border bg-card px-2 text-center text-foreground ${unset && !changed ? "border-warning" : ""}`}
        />
      </> : <>Stock quantity uses</>}
      <select aria-label={`Stock unit for ${name}`} className="h-8 rounded-lg border border-input bg-card px-1.5" value={selectedUnit} onChange={(e) => {
        const nextUnit = e.target.value as StockUnit;
        const pieces = Number(text) * STOCK_UNIT_FACTOR[selectedUnit];
        setSelectedUnit(nextUnit);
        if (text.trim() && Number.isFinite(pieces)) setText(String(Number((pieces / STOCK_UNIT_FACTOR[nextUnit]).toFixed(2))));
      }}>
        {STOCK_UNITS.map((unit) => <option key={unit} value={unit}>{stockUnitLabel(unit)}</option>)}
      </select>
      <select aria-label={`Stock format for ${name}`} className="h-8 rounded-lg border border-input bg-card px-1.5" value={selectedMode} onChange={(e) => setSelectedMode(e.target.value as StockMode)}>
        {STOCK_MODES.map((mode) => <option key={mode} value={mode}>{mode === "UNIT_ONLY" ? "unit only" : "cartons + unit"}</option>)}
      </select>
      {changed && (selectedMode === "UNIT_ONLY" || (/^\d+(\.\d{1,2})?$/.test(text.trim()) && Number(text) > 0)) && <Button size="sm" className="h-8" disabled={busy} onClick={save}>Save</Button>}
      {unset && selectedMode === "CARTONS_AND_UNITS" && !changed && <span className="text-warning-foreground">not set yet</span>}
    </span>
  );
}
