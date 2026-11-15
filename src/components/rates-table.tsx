"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quickEditProductAction } from "@/actions/products";
import { callAction } from "@/lib/client/call-action";
import { formatQuantity } from "@/lib/money";
import { D, toFixed4 } from "@/lib/money";
import { DOZEN_PIECES, PATTY_PIECES } from "@/lib/units";

type Item = { id: string; name: string; qtyPerCarton: number; size: string | null; categoryId: string | null; categoryName: string | null; unitPrice: string; rateA: string | null; rateC: string | null; gstRate: string; unit: string; isActive: boolean };

const show = (v: string | null) => (v === null || Number(v) === 0 ? "" : Number(v).toFixed(4).replace(/0+$/, "").replace(/\.$/, ""));
const RATE_UNITS = [
  { key: "patty", label: "Patty", pieces: PATTY_PIECES },
  { key: "dozen", label: "Dozen", pieces: DOZEN_PIECES },
  { key: "piece", label: "Piece", pieces: 1 },
] as const;
type Tier = "A" | "B" | "C";
type RateUnit = (typeof RATE_UNITS)[number]["key"];

/** One row of the rates table: the name and the three rates (A, B, C), then Save. */
function RateRow({ item }: { item: Item }) {
  const router = useRouter();
  const shown = { A: show(item.rateA), B: show(item.unitPrice), C: show(item.rateC) };
  const [name, setName] = useState(item.name);
  const [rates, setRates] = useState(shown);
  const [busy, setBusy] = useState(false);
  // Rates are saved per piece; these fields let the owner enter the same rate per patty, dozen or piece.
  const [typed, setTyped] = useState<Record<Tier, Partial<Record<RateUnit, string>>>>({ A: {}, B: {}, C: {} });
  const changedName = name.trim() !== item.name;
  // Rate B must have a number; A and C may be emptied to mean "same as Rate B".
  const changed = {
    A: rates.A.trim() !== shown.A,
    B: rates.B.trim() !== "" && rates.B.trim() !== shown.B,
    C: rates.C.trim() !== shown.C,
  };
  const anyChange = changedName || changed.A || changed.B || changed.C;

  async function save() {
    setBusy(true);
    const ok = await callAction(
      quickEditProductAction({
        id: item.id,
        ...(changedName ? { name } : {}),
        ...(changed.A ? { rateA: rates.A.trim() } : {}),
        ...(changed.B ? { unitPrice: rates.B.trim() } : {}),
        ...(changed.C ? { rateC: rates.C.trim() } : {}),
      }),
      { success: "Saved" }
    );
    setBusy(false);
    if (ok) router.refresh();
  }
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter" && anyChange && !busy) void save(); };
  const setRate = (tier: Tier, unit: RateUnit, value: string) => {
    const factor = RATE_UNITS.find((u) => u.key === unit)!.pieces;
    let perPiece = "";
    if (value.trim()) {
      try { perPiece = toFixed4(D(value.trim().replace(/,/g, "")).div(factor)); } catch { perPiece = ""; }
    }
    setRates({ ...rates, [tier]: perPiece });
    setTyped({ ...typed, [tier]: { [unit]: value } });
  };
  const rateBox = (tier: Tier, label: string, placeholder: string) => {
    return (
      <div className="rounded-lg border bg-muted/30 p-2" data-testid={`rate-box-${tier}`}>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">{label}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {RATE_UNITS.map((unit) => {
            const perUnit = rates[tier].trim() ? D(rates[tier]).times(unit.pieces).toDecimalPlaces(2).toFixed(2) : "";
            return <label key={unit.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {unit.label} ₹
              <Input aria-label={`Per ${unit.label.toLowerCase()} ${tier} for ${item.name}`} inputMode="decimal" placeholder={placeholder} className="h-10 w-24 text-right"
                value={typed[tier][unit.key] ?? perUnit} onChange={(e) => setRate(tier, unit.key, e.target.value)} onKeyDown={onEnter} />
            </label>;
          })}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Saved as a per-piece rate for accurate billing.</p>
      </div>
    );
  };

  return (
    <li className="flex flex-wrap items-center gap-2 p-3" data-testid="rate-row">
      {item.size && <span className="rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground" data-testid="size-badge">Size {item.size}</span>}
      <Input aria-label={`Name of ${item.name}`} className="h-11 min-w-0 flex-1 basis-56" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} />
      <div className="flex w-full flex-wrap gap-2">
        {rateBox("A", "Rate A · big wholesalers", "as B")}
        {rateBox("B", "Rate B · normal wholesalers", "not set")}
        {rateBox("C", "Rate C · direct vendors", "as B")}
      </div>
      <span className="w-16 text-sm text-muted-foreground">GST {formatQuantity(item.gstRate)}%</span>
      {Number(item.unitPrice) === 0 && !changed.B && <Badge variant="destructive">Price not set</Badge>}
      {changedName && <span className="text-sm text-warning-foreground">new name</span>}
      <Button size="sm" className="h-11" disabled={!anyChange || busy} onClick={save}>Save</Button>
    </li>
  );
}

export function RatesTable({ items, categories }: { items: Item[]; categories: { id: string; name: string }[] }) {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [onlyUnset, setOnlyUnset] = useState(false);
  const needle = search.trim().toLowerCase();
  const visible = items
    .filter((i) => i.isActive && `${i.name} ${i.size ?? ""} ${i.categoryName ?? ""}`.toLowerCase().includes(needle) && (!onlyUnset || Number(i.unitPrice) === 0))
    .filter((i) => categoryId === "" || (categoryId === "none" ? i.categoryId === null : i.categoryId === categoryId))
    .sort((a, b) => (a.categoryName ?? "~").localeCompare(b.categoryName ?? "~") || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const unset = items.filter((i) => i.isActive && Number(i.unitPrice) === 0).length;
  return (
    <div className="space-y-3" data-testid="rates-table">
      <p className="text-sm text-muted-foreground">
        Enter each GST-inclusive rate per piece, dozen, or patty; the bill extracts the GST from that amount and converts it to the quantity unit you choose on the line. <b>A</b> is for big wholesalers (lowest), <b>B</b> is the standard rate, and <b>C</b> is for direct vendors (highest). Leave A or C empty to use B. New bills use updated rates; saved bills keep their original rates.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Search item, size or category" className="h-11 max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Show category" className="h-11 rounded-lg border border-input bg-card px-2.5" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          <option value="none">Not in any category</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyUnset} onChange={(e) => setOnlyUnset(e.target.checked)} /> Only items with no rate yet ({unset})</label>
      </div>
      <ul className="divide-y divide-border/80 rounded-xl bg-card ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]">
        {visible.map((i) => <RateRow key={`${i.id}-${i.name}-${i.unitPrice}-${i.rateA}-${i.rateC}`} item={i} />)}
        {visible.length === 0 && <li className="p-6 text-center text-muted-foreground">No items.</li>}
      </ul>
    </div>
  );
}
