"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/field";
import { RatesTable } from "@/components/rates-table";
import { adjustRatesAction, createProductAction, importProductsAction, setAllGstRateAction, setProductActiveAction, updateProductAction } from "@/actions/products";
import { callAction } from "@/lib/client/call-action";
import { formatINR } from "@/lib/money";

type Product = { id: string; sku: string | null; name: string; unit: string; qtyPerCarton: number; hsnCode: string; unitPrice: string; rateA: string | null; rateC: string | null; gstRate: string; reorderLevel: string; isActive: boolean };
const EMPTY = { sku: "", name: "", unit: "pcs", qtyPerCarton: "1", hsnCode: "", unitPrice: "", rateA: "", rateC: "", gstRate: "5", reorderLevel: "0" };
type Editing = typeof EMPTY & { id?: string };
type ImportResult = { errors: { rowNumber: number; message: string }[]; toCreate: number; toUpdate: number; created: number; updated: number };

export function ProductsManager({ products }: { products: Product[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"items" | "rates">("items");
  const [gstAll, setGstAll] = useState<string | null>(null);
  const [bump, setBump] = useState<{ percent: string; tiers: ("A" | "B" | "C")[] } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);

  const visible = products.filter((p) => `${p.name} ${p.sku ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  async function save() {
    if (!editing) return;
    const { id, ...fields } = editing;
    const done = await callAction(id ? updateProductAction({ id, ...fields }) : createProductAction(fields), { success: "Product saved" });
    if (done) { setEditing(null); router.refresh(); }
  }

  async function runImport(dryRun: boolean) {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("dryRun", String(dryRun));
    const result = await callAction(importProductsAction(form), dryRun ? {} : { success: "Products imported" });
    if (!result) return;
    if (dryRun) setPreview(result);
    else { setImportOpen(false); setPreview(null); setFile(null); router.refresh(); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Products</h1>
        <Button variant="outline" onClick={() => setBump({ percent: "", tiers: ["A", "B", "C"] })}>Change all rates by %</Button>
        <Button variant="outline" onClick={() => setGstAll("5")}>Set GST for all items</Button>
        <Button variant="outline" onClick={() => setImportOpen(true)}>Import from Excel</Button>
        <Button onClick={() => setEditing({ ...EMPTY })}>Add product</Button>
      </div>
      <div role="group" aria-label="Products view" className="inline-flex overflow-hidden rounded-md border">
        <button type="button" aria-pressed={view === "items"} onClick={() => setView("items")} className={`px-3 py-2 text-sm ${view === "items" ? "bg-primary text-primary-foreground" : "bg-background"}`}>All details</button>
        <button type="button" aria-pressed={view === "rates"} onClick={() => setView("rates")} className={`px-3 py-2 text-sm ${view === "rates" ? "bg-primary text-primary-foreground" : "bg-background"}`}>Rates and names</button>
      </div>
      {view === "rates" && <RatesTable items={products} />}
      {view === "items" && <Input placeholder="Search name or code" className="h-11" value={search} onChange={(e) => setSearch(e.target.value)} />}
      {view === "items" && <ul className="divide-y rounded-md border bg-background">
        {visible.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="mr-auto">
              <p className="font-medium">{p.name} {!p.isActive && <Badge variant="secondary">Inactive</Badge>} {Number(p.unitPrice) === 0 && <Badge variant="destructive">Price not set</Badge>}</p>
              <p className="text-sm text-muted-foreground">{p.sku ? `${p.sku} · ` : ""}{p.qtyPerCarton} {p.unit}/carton · HSN {p.hsnCode} · GST {p.gstRate}% · Rates {p.rateA ? `A ${formatINR(p.rateA)} · ` : ""}B {formatINR(p.unitPrice)}{p.rateC ? ` · C ${formatINR(p.rateC)}` : ""} per {p.unit}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing({ ...p, sku: p.sku ?? "", rateA: p.rateA ?? "", rateC: p.rateC ?? "", qtyPerCarton: String(p.qtyPerCarton) })}>Edit</Button>
            <Button variant="ghost" size="sm" onClick={async () => { if (await callAction(setProductActiveAction({ id: p.id, isActive: !p.isActive }))) router.refresh(); }}>
              {p.isActive ? "Deactivate" : "Activate"}
            </Button>
          </li>
        ))}
        {visible.length === 0 && <li className="p-6 text-center text-muted-foreground">No products yet. Add one or import from Excel.</li>}
      </ul>}

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Edit product" : "Add product"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="name" label="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} hint="You can rename an item any time. Bills already made keep the name they were printed with." />
              <Field id="sku" label="Code (optional)" value={editing.sku} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} hint="Leave empty if you do not use item codes" />
              <Field id="price" label="Rate B: normal wholesalers (before GST)" inputMode="decimal" value={editing.unitPrice} onChange={(e) => setEditing({ ...editing, unitPrice: e.target.value })} hint="The standard rate" />
              <Field id="rateA" label="Rate A: big wholesalers (optional)" inputMode="decimal" value={editing.rateA} onChange={(e) => setEditing({ ...editing, rateA: e.target.value })} hint="Lowest rate. Empty means same as B" />
              <Field id="rateC" label="Rate C: direct vendors (optional)" inputMode="decimal" value={editing.rateC} onChange={(e) => setEditing({ ...editing, rateC: e.target.value })} hint="Highest rate, like near Diwali. Empty means same as B" />
              <Field id="unit" label="Unit" value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} />
              <Field id="qpc" label="Pieces in one carton" inputMode="numeric" value={editing.qtyPerCarton} onChange={(e) => setEditing({ ...editing, qtyPerCarton: e.target.value })} hint="Different for each item, e.g. 12 for birthday candles, 40 for masjid candles" />
              <Field id="hsn" label="HSN code" inputMode="numeric" value={editing.hsnCode} onChange={(e) => setEditing({ ...editing, hsnCode: e.target.value })} />
              <Field id="gst" label="GST %" inputMode="decimal" value={editing.gstRate} onChange={(e) => setEditing({ ...editing, gstRate: e.target.value })} hint="Confirm with your CA" />
              <Field id="reorder" label="Warn when stock falls to" inputMode="decimal" value={editing.reorderLevel} onChange={(e) => setEditing({ ...editing, reorderLevel: e.target.value })} />
              <Button className="sm:col-span-2" size="lg" onClick={save}>Save</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={bump !== null} onOpenChange={(open) => { if (!open) setBump(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Change all rates by a percentage</DialogTitle></DialogHeader>
          {bump && (
            <div className="space-y-3">
              <Field id="bump-percent" label="Percent change" inputMode="decimal" value={bump.percent} onChange={(e) => setBump({ ...bump, percent: e.target.value })} hint="Type 5 to raise every rate by 5%, or -3 to lower by 3%. Use this when the price of wax changes." />
              <div className="space-y-1">
                <p className="text-sm font-medium">Which rates?</p>
                {(["A", "B", "C"] as const).map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={bump.tiers.includes(t)} onChange={(e) => setBump({ ...bump, tiers: e.target.checked ? [...bump.tiers, t] : bump.tiers.filter((x) => x !== t) })} />
                    {t === "A" ? "Rate A (big wholesalers)" : t === "B" ? "Rate B (normal wholesalers)" : "Rate C (direct vendors)"}
                  </label>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">Only rates that are already set are changed. New bills use the new rates; bills already made keep the old ones. Every change is saved in each item&apos;s rate history.</p>
              <Button size="lg" className="w-full" onClick={async () => {
                const done = await callAction(adjustRatesAction({ percent: bump.percent, tiers: bump.tiers }));
                if (done) { toast.success(done.changedItems === 0 ? "No rates were set, so nothing changed" : `Rates changed by ${done.percent}% on ${done.changedItems} item(s)`); setBump(null); router.refresh(); }
              }}>Change the rates</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={gstAll !== null} onOpenChange={(open) => { if (!open) setGstAll(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Set GST for all items</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field id="gst-all" label="GST % for every item" inputMode="decimal" value={gstAll ?? ""} onChange={(e) => setGstAll(e.target.value)} hint="Confirm the right rate with your CA" />
            <p className="text-sm text-muted-foreground">This changes all active items. New bills use it; bills already made keep the rate they were printed with. You can still change one item later.</p>
            <Button size="lg" className="w-full" onClick={async () => {
              const done = await callAction(setAllGstRateAction({ gstRate: gstAll }));
              if (done) { toast.success(done.changed === 0 ? `Every item already has ${done.gstRate}% GST` : `GST set to ${done.gstRate}% on ${done.changed} item(s)`); setGstAll(null); router.refresh(); }
            }}>Change GST for all items</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) { setPreview(null); setFile(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Import products from Excel</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">First row must be headings: <b>Name, HSN, GST %, Price</b> (optional: Code, Unit, Qty per carton, Reorder level). Items already in the list (same code, or same name) are updated.</p>
          <Input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
          {preview && (
            <div className="space-y-2 text-sm">
              <p>{preview.toCreate} new, {preview.toUpdate} to update.</p>
              {preview.errors.length > 0 && (
                <ul className="max-h-40 overflow-auto rounded border border-destructive/40 p-2 text-destructive">
                  {preview.errors.map((e) => <li key={e.rowNumber}>Row {e.rowNumber}: {e.message}</li>)}
                </ul>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" disabled={!file} onClick={() => runImport(true)}>Check file</Button>
            <Button disabled={!preview || preview.errors.length > 0} onClick={() => runImport(false)}>Import</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
