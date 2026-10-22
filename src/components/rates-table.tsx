"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quickEditProductAction } from "@/actions/products";
import { callAction } from "@/lib/client/call-action";
import { formatQuantity } from "@/lib/money";

type Item = { id: string; name: string; qtyPerCarton: number; size: string | null; categoryId: string | null; categoryName: string | null; unitPrice: string; rateA: string | null; rateC: string | null; gstRate: string; unit: string; isActive: boolean };

const show = (v: string | null) => (v === null || Number(v) === 0 ? "" : Number(v).toFixed(2));

/** One row of the rates table: the name and the three rates (A, B, C), then Save. */
function RateRow({ item }: { item: Item }) {
  const router = useRouter();
  const shown = { A: show(item.rateA), B: show(item.unitPrice), C: show(item.rateC) };
  const [name, setName] = useState(item.name);
  const [rates, setRates] = useState(shown);
  const [busy, setBusy] = useState(false);
  // What was typed in a Carton box (null = show the worked-out figure). Stored rates are always per piece.
  const [cartonTyped, setCartonTyped] = useState<{ A: string | null; B: string | null; C: string | null }>({ A: null, B: null, C: null });
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
  const qpc = item.qtyPerCarton;
  const cartonOf = (piece: string) => {
    const n = Number(piece);
    return piece.trim() === "" || !Number.isFinite(n) ? "" : (n * qpc).toFixed(2);
  };
  const setPiece = (tier: "A" | "B" | "C", value: string) => { setRates({ ...rates, [tier]: value }); setCartonTyped({ ...cartonTyped, [tier]: null }); };
  const setCarton = (tier: "A" | "B" | "C", value: string) => {
    const n = Number(value);
    setCartonTyped({ ...cartonTyped, [tier]: value });
    setRates({ ...rates, [tier]: value.trim() === "" || !Number.isFinite(n) ? "" : (n / qpc).toFixed(2) });
  };
  const rateBox = (tier: "A" | "B" | "C", label: string, placeholder: string) => {
    const roundedCarton = cartonOf(rates[tier]);
    const typed = cartonTyped[tier];
    const off = typed !== null && typed.trim() !== "" && roundedCarton !== "" && Math.abs(Number(typed) - Number(roundedCarton)) >= 0.005;
    return (
      <div className="rounded-lg border bg-muted/30 p-2" data-testid={`rate-box-${tier}`}>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">{label}</p>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Carton ₹</span>
          <Input aria-label={`Per carton ${tier} for ${item.name}`} inputMode="decimal" placeholder={placeholder} className="h-10 w-24 text-right"
            value={typed ?? roundedCarton} onChange={(e) => setCarton(tier, e.target.value)} onKeyDown={onEnter} />
          <span className="text-xs text-muted-foreground">Piece ₹</span>
          <Input aria-label={`Rate ${tier} of ${item.name}`} inputMode="decimal" placeholder={placeholder} className="h-10 w-24 text-right"
            value={rates[tier]} onChange={(e) => setPiece(tier, e.target.value)} onKeyDown={onEnter} />
        </div>
        {off && <p className="mt-1 text-xs text-amber-700">Saved per piece as ₹{rates[tier]}, so a carton works out to ₹{roundedCarton}.</p>}
      </div>
    );
  };

  return (
    <li className="flex flex-wrap items-center gap-2 p-3" data-testid="rate-row">
      {item.size && <span className="rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground" data-testid="size-badge">Size {item.size}</span>}
      <Input aria-label={`Name of ${item.name}`} className="h-11 min-w-0 flex-1 basis-56" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} />
      <div className="flex w-full flex-wrap gap-2">
        {rateBox("A", `Rate A · big wholesalers (1 carton = ${qpc})`, "as B")}
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
        Every item has three rates (price before GST). <b>A</b> is for big wholesalers who take a huge quantity (lowest). <b>B</b> is for normal wholesalers (the standard rate). <b>C</b> is for direct vendors who take a little, like near Diwali (highest). Leave A or C empty to use the B rate. You can also change an item&apos;s name here. New bills use the new rates; bills already made keep the old ones.
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
