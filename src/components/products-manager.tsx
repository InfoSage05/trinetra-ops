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
import { CategoryManager, type CategoryRow } from "@/components/category-manager";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { assignCategoryAction } from "@/actions/categories";
import { adjustRatesAction, createProductAction, deleteProductAction, importProductsAction, setAllGstRateAction, setProductActiveAction, updateProductAction } from "@/actions/products";
import { callAction } from "@/lib/client/call-action";
import { formatINR } from "@/lib/money";

type Product = { id: string; sku: string | null; name: string; size: string | null; categoryId: string | null; categoryName: string | null; unit: string; qtyPerCarton: number; hsnCode: string; unitPrice: string; rateA: string | null; rateC: string | null; gstRate: string; reorderLevel: string; isActive: boolean };
const EMPTY = { sku: "", name: "", size: "", categoryId: "", unit: "pcs", qtyPerCarton: "1", hsnCode: "", unitPrice: "", rateA: "", rateC: "", gstRate: "5", reorderLevel: "0" };
type Editing = typeof EMPTY & { id?: string };
type ImportResult = { errors: { rowNumber: number; message: string }[]; toCreate: number; toUpdate: number; created: number; updated: number };

const NONE = "none";
const byName = (a: Product, b: Product) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

export function ProductsManager({ products, categories }: { products: Product[]; categories: CategoryRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"items" | "rates">("items");
  const [gstAll, setGstAll] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState(""); // "" = all, NONE = items without a category, else a category id
  const [expanded, setExpanded] = useState<Set<string>>(new Set([NONE]));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState("");
  const [managing, setManaging] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [bump, setBump] = useState<{ percent: string; tiers: ("A" | "B" | "C")[] } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);

  const needle = search.trim().toLowerCase();
  const visible = products
    .filter((p) => `${p.name} ${p.sku ?? ""} ${p.size ?? ""} ${p.categoryName ?? ""}`.toLowerCase().includes(needle))
    .filter((p) => categoryFilter === "" || (categoryFilter === NONE ? p.categoryId === null : p.categoryId === categoryFilter))
    .sort(byName);
  // Items grouped into their sections. The not-yet-sorted items come first so they are easy to move.
  const groups = [
    { key: NONE, title: "Not in any category yet", items: visible.filter((p) => p.categoryId === null) },
    ...categories.map((c) => ({ key: c.id, title: c.name, items: visible.filter((p) => p.categoryId === c.id) })),
  ].filter((g) => g.items.length > 0);
  const isOpen = (key: string) => needle !== "" || categoryFilter !== "" || expanded.has(key);
  const toggle = (key: string) => setExpanded((cur) => { const next = new Set(cur); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const pick = (ids: string[], on: boolean) => setPicked((cur) => { const next = new Set(cur); for (const id of ids) { if (on) next.add(id); else next.delete(id); } return next; });

  async function moveSelected() {
    const done = await callAction(assignCategoryAction({ productIds: [...picked], categoryId: moveTo === NONE ? "" : moveTo }));
    if (done) { toast.success(`Moved ${done.moved} item(s)`); setPicked(new Set()); setMoveTo(""); router.refresh(); }
  }

  async function removeItem() {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    const done = await callAction(deleteProductAction({ id: target.id }));
    if (done) { toast.success(`Deleted ${done.name}`); router.refresh(); }
  }

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
        <h1 className="mr-auto">Products</h1>
        <Button variant="outline" onClick={() => setManaging(true)}>Categories</Button>
        <Button variant="outline" onClick={() => setBump({ percent: "", tiers: ["A", "B", "C"] })}>Change all rates by %</Button>
        <Button variant="outline" onClick={() => setGstAll("5")}>Set GST for all items</Button>
        <Button variant="outline" onClick={() => setImportOpen(true)}>Import from Excel</Button>
        <Button onClick={() => setEditing({ ...EMPTY })}>Add product</Button>
      </div>
      <div role="group" aria-label="Products view" className="inline-flex rounded-lg bg-muted p-1 shadow-[inset_0_1px_2px_rgb(64_38_16/0.06)]">
        <button type="button" aria-pressed={view === "items"} onClick={() => setView("items")} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${view === "items" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>All details</button>
        <button type="button" aria-pressed={view === "rates"} onClick={() => setView("rates")} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${view === "rates" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Rates and names</button>
      </div>
      {view === "rates" && <RatesTable items={products} categories={categories} />}
      {view === "items" && (
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search name, size or category" className="h-11 min-w-0 flex-1 basis-60" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label="Show category" className="h-11 rounded-lg border border-input bg-card px-2.5" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            <option value={NONE}>Not in any category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.itemCount})</option>)}
          </select>
        </div>
      )}
      {view === "items" && picked.size > 0 && (
        <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-card p-3 shadow-md ring-1 ring-foreground/10" data-testid="move-bar">
          <span className="text-sm font-medium">{picked.size} item(s) chosen</span>
          <select aria-label="Move chosen items to" className="h-10 rounded-lg border border-input bg-card px-2.5" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">Move to…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={NONE}>No category</option>
          </select>
          <Button className="h-10" disabled={moveTo === ""} onClick={moveSelected}>Move</Button>
          <Button className="h-10" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
        </div>
      )}
      {view === "items" && (
        <div className="space-y-3">
          {groups.map((g) => (
            <section key={g.key} className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]" data-testid="category-group">
              <div className="flex items-center gap-2 bg-muted/60 px-3 py-2">
                <input type="checkbox" aria-label={`Choose all in ${g.title}`} checked={g.items.every((p) => picked.has(p.id))} onChange={(e) => pick(g.items.map((p) => p.id), e.target.checked)} />
                <button type="button" aria-expanded={isOpen(g.key)} className="flex flex-1 items-center gap-2 text-left font-semibold" onClick={() => toggle(g.key)}>
                  <span aria-hidden>{isOpen(g.key) ? "▾" : "▸"}</span> {g.title}
                  <span className="text-sm font-normal text-muted-foreground">({g.items.length})</span>
                </button>
              </div>
              {isOpen(g.key) && (
                <ul className="divide-y divide-border/80">
                  {g.items.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 p-3" data-testid="product-row">
                      <input type="checkbox" aria-label={`Choose ${p.name}`} checked={picked.has(p.id)} onChange={(e) => pick([p.id], e.target.checked)} />
                      <div className="mr-auto min-w-0">
                        <p className="font-medium">
                          {p.name} {p.size && <Badge variant="outline" data-testid="size-badge">Size {p.size}</Badge>} {!p.isActive && <Badge variant="secondary">Inactive</Badge>} {Number(p.unitPrice) === 0 && <Badge variant="destructive">Price not set</Badge>}
                        </p>
                        <p className="text-sm text-muted-foreground">{p.sku ? `${p.sku} · ` : ""}{p.qtyPerCarton} {p.unit}/carton · HSN {p.hsnCode} · GST {p.gstRate}% · Per piece: {p.rateA ? `A ${formatINR(p.rateA)} · ` : ""}B {formatINR(p.unitPrice)}{p.rateC ? ` · C ${formatINR(p.rateC)}` : ""} · Per carton: {p.rateA ? `A ${formatINR(Number(p.rateA) * p.qtyPerCarton)} · ` : ""}B {formatINR(Number(p.unitPrice) * p.qtyPerCarton)}{p.rateC ? ` · C ${formatINR(Number(p.rateC) * p.qtyPerCarton)}` : ""}</p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setEditing({ ...p, sku: p.sku ?? "", size: p.size ?? "", categoryId: p.categoryId ?? "", rateA: p.rateA ?? "", rateC: p.rateC ?? "", qtyPerCarton: String(p.qtyPerCarton) })}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={async () => { if (await callAction(setProductActiveAction({ id: p.id, isActive: !p.isActive }))) router.refresh(); }}>
                        {p.isActive ? "Deactivate" : "Activate"}
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Delete ${p.name}`} className="text-destructive" onClick={() => setDeleting(p)}>Delete</Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {groups.length === 0 && <p className="rounded-xl bg-card p-6 text-center text-muted-foreground ring-1 ring-foreground/10">{needle || categoryFilter ? "No items match." : "No products yet. Add one or import from Excel."}</p>}
        </div>
      )}

      <CategoryManager open={managing} onClose={() => setManaging(false)} categories={categories} />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>This removes the item for good. It only works for an item that was added by mistake and was never billed, made, counted or ordered. Otherwise use Deactivate to hide it; all records are kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={removeItem}>Yes, delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Edit product" : "Add product"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="name" label="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} hint="You can rename an item any time. Bills already made keep the name they were printed with." />
              <div className="space-y-1.5">
                <label htmlFor="pcat" className="text-sm font-medium">Category</label>
                <select id="pcat" className="h-12 w-full rounded-lg border border-input bg-card px-2.5" value={editing.categoryId} onChange={(e) => setEditing({ ...editing, categoryId: e.target.value })}>
                  <option value="">No category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">The section this item is listed under. You choose it.</p>
              </div>
              <Field id="size" label="Size (optional)" value={editing.size} onChange={(e) => setEditing({ ...editing, size: e.target.value })} hint="A short label shown beside the name, like 12 or 3 x 14" />
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
          <p className="text-sm text-muted-foreground">First row must be headings: <b>Name, HSN, GST %, Price</b> (optional: Size, Code, Unit, Qty per carton, Reorder level, Rate A, Rate C). Items already in the list (same code, or same name) are updated.</p>
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
