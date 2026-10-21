"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quickEditProductAction } from "@/actions/products";
import { callAction } from "@/lib/client/call-action";
import { formatQuantity } from "@/lib/money";

type Item = { id: string; name: string; unitPrice: string; gstRate: string; unit: string; isActive: boolean };

/** One row of the rates table: change the rate and, if it helps, the name, then Save. */
function RateRow({ item }: { item: Item }) {
  const router = useRouter();
  const noRate = Number(item.unitPrice) === 0;
  const [name, setName] = useState(item.name);
  const shownRate = noRate ? "" : Number(item.unitPrice).toFixed(2);
  const [rate, setRate] = useState(shownRate);
  const [busy, setBusy] = useState(false);
  const changedName = name.trim() !== item.name;
  const changedRate = rate.trim() !== "" && rate.trim() !== shownRate;
  const changed = changedName || changedRate;

  async function save() {
    setBusy(true);
    const ok = await callAction(
      quickEditProductAction({ id: item.id, ...(changedName ? { name } : {}), ...(changedRate ? { unitPrice: rate } : {}) }),
      { success: "Saved" }
    );
    setBusy(false);
    if (ok) router.refresh();
  }
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter" && changed && !busy) void save(); };

  return (
    <li className="flex flex-wrap items-center gap-2 p-3" data-testid="rate-row">
      <Input aria-label={`Name of ${item.name}`} className="h-11 min-w-0 flex-1 basis-56" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} />
      <div className="flex items-center gap-1">
        <span className="text-sm text-muted-foreground">Rate ₹</span>
        <Input aria-label={`Rate of ${item.name}`} inputMode="decimal" placeholder="not set" className="h-11 w-28 text-right" value={rate} onChange={(e) => setRate(e.target.value)} onKeyDown={onEnter} />
        <span className="text-sm text-muted-foreground">per {item.unit}</span>
      </div>
      <span className="w-20 text-sm text-muted-foreground">GST {formatQuantity(item.gstRate)}%</span>
      {noRate && !changedRate && <Badge variant="destructive">Price not set</Badge>}
      {changedName && <span className="text-sm text-amber-700">new name</span>}
      <Button size="sm" className="h-11" disabled={!changed || busy} onClick={save}>Save</Button>
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
        Change the rate (price before GST) of any item here. You can also change an item&apos;s name if it helps you remember it. New bills use the new rate; bills already made keep the old one.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Search item" className="h-11 max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyUnset} onChange={(e) => setOnlyUnset(e.target.checked)} /> Only items with no rate yet ({unset})</label>
      </div>
      <ul className="divide-y rounded-md border bg-background">
        {visible.map((i) => <RateRow key={`${i.id}-${i.name}-${i.unitPrice}`} item={i} />)}
        {visible.length === 0 && <li className="p-6 text-center text-muted-foreground">No items.</li>}
      </ul>
    </div>
  );
}
