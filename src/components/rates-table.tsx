"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quickEditProductAction } from "@/actions/products";
import { callAction } from "@/lib/client/call-action";
import { formatQuantity } from "@/lib/money";

type Item = { id: string; name: string; unitPrice: string; rateA: string | null; rateC: string | null; gstRate: string; unit: string; isActive: boolean };

const show = (v: string | null) => (v === null || Number(v) === 0 ? "" : Number(v).toFixed(2));

/** One row of the rates table: the name and the three rates (A, B, C), then Save. */
function RateRow({ item }: { item: Item }) {
  const router = useRouter();
  const shown = { A: show(item.rateA), B: show(item.unitPrice), C: show(item.rateC) };
  const [name, setName] = useState(item.name);
  const [rates, setRates] = useState(shown);
  const [busy, setBusy] = useState(false);
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
  const rateInput = (tier: "A" | "B" | "C", placeholder: string) => (
    <Input
      aria-label={`Rate ${tier} of ${item.name}`} inputMode="decimal" placeholder={placeholder} className="h-11 w-24 text-right"
      value={rates[tier]} onChange={(e) => setRates({ ...rates, [tier]: e.target.value })} onKeyDown={onEnter}
    />
  );

  return (
    <li className="flex flex-wrap items-center gap-2 p-3" data-testid="rate-row">
      <Input aria-label={`Name of ${item.name}`} className="h-11 min-w-0 flex-1 basis-56" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} />
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground">₹ A</span>{rateInput("A", "as B")}
        <span className="text-sm text-muted-foreground">B</span>{rateInput("B", "not set")}
        <span className="text-sm text-muted-foreground">C</span>{rateInput("C", "as B")}
      </div>
      <span className="w-16 text-sm text-muted-foreground">GST {formatQuantity(item.gstRate)}%</span>
      {Number(item.unitPrice) === 0 && !changed.B && <Badge variant="destructive">Price not set</Badge>}
      {changedName && <span className="text-sm text-amber-700">new name</span>}
      <Button size="sm" className="h-11" disabled={!anyChange || busy} onClick={save}>Save</Button>
    </li>
  );
}

export function RatesTable({ items }: { items: Item[] }) {
  const [search, setSearch] = useState("");
  const [onlyUnset, setOnlyUnset] = useState(false);
  const visible = items.filter((i) => i.isActive && i.name.toLowerCase().includes(search.toLowerCase()) && (!onlyUnset || Number(i.unitPrice) === 0));
  const unset = items.filter((i) => i.isActive && Number(i.unitPrice) === 0).length;
  return (
    <div className="space-y-3" data-testid="rates-table">
      <p className="text-sm text-muted-foreground">
        Every item has three rates (price before GST). <b>A</b> is for big wholesalers who take a huge quantity (lowest). <b>B</b> is for normal wholesalers (the standard rate). <b>C</b> is for direct vendors who take a little, like near Diwali (highest). Leave A or C empty to use the B rate. You can also change an item&apos;s name here. New bills use the new rates; bills already made keep the old ones.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Search item" className="h-11 max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyUnset} onChange={(e) => setOnlyUnset(e.target.checked)} /> Only items with no rate yet ({unset})</label>
      </div>
      <ul className="divide-y rounded-md border bg-background">
        {visible.map((i) => <RateRow key={`${i.id}-${i.name}-${i.unitPrice}-${i.rateA}-${i.rateC}`} item={i} />)}
        {visible.length === 0 && <li className="p-6 text-center text-muted-foreground">No items.</li>}
      </ul>
    </div>
  );
}
