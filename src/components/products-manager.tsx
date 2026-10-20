"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/field";
import { createProductAction, importProductsAction, setProductActiveAction, updateProductAction } from "@/actions/products";
import { callAction } from "@/lib/client/call-action";
import { formatINR } from "@/lib/money";

type Product = { id: string; sku: string; name: string; unit: string; hsnCode: string; unitPrice: string; gstRate: string; reorderLevel: string; isActive: boolean };
const EMPTY = { sku: "", name: "", unit: "pcs", hsnCode: "", unitPrice: "", gstRate: "", reorderLevel: "0" };
type Editing = typeof EMPTY & { id?: string };
type ImportResult = { errors: { rowNumber: number; message: string }[]; toCreate: number; toUpdate: number; created: number; updated: number };

export function ProductsManager({ products }: { products: Product[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);

  const visible = products.filter((p) => `${p.name} ${p.sku}`.toLowerCase().includes(search.toLowerCase()));

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
        <Button variant="outline" onClick={() => setImportOpen(true)}>Import from Excel</Button>
        <Button onClick={() => setEditing({ ...EMPTY })}>Add product</Button>
      </div>
      <Input placeholder="Search name or SKU" className="h-11" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ul className="divide-y rounded-md border bg-background">
        {visible.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="mr-auto">
              <p className="font-medium">{p.name} {!p.isActive && <Badge variant="secondary">Inactive</Badge>}</p>
              <p className="text-sm text-muted-foreground">{p.sku} · HSN {p.hsnCode} · GST {p.gstRate}% · {formatINR(p.unitPrice)}/{p.unit}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing({ ...p })}>Edit</Button>
            <Button variant="ghost" size="sm" onClick={async () => { if (await callAction(setProductActiveAction({ id: p.id, isActive: !p.isActive }))) router.refresh(); }}>
              {p.isActive ? "Deactivate" : "Activate"}
            </Button>
          </li>
        ))}
        {visible.length === 0 && <li className="p-6 text-center text-muted-foreground">No products yet. Add one or import from Excel.</li>}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Edit product" : "Add product"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="sku" label="SKU / code" value={editing.sku} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} />
              <Field id="name" label="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              <Field id="price" label="Price (before GST)" inputMode="decimal" value={editing.unitPrice} onChange={(e) => setEditing({ ...editing, unitPrice: e.target.value })} />
              <Field id="unit" label="Unit" value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })} />
              <Field id="hsn" label="HSN code" inputMode="numeric" value={editing.hsnCode} onChange={(e) => setEditing({ ...editing, hsnCode: e.target.value })} />
              <Field id="gst" label="GST %" inputMode="decimal" value={editing.gstRate} onChange={(e) => setEditing({ ...editing, gstRate: e.target.value })} hint="Confirm with your CA" />
              <Field id="reorder" label="Warn when stock falls to" inputMode="decimal" value={editing.reorderLevel} onChange={(e) => setEditing({ ...editing, reorderLevel: e.target.value })} />
              <Button className="sm:col-span-2" size="lg" onClick={save}>Save</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) { setPreview(null); setFile(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Import products from Excel</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">First row must be headings: <b>SKU, Name, HSN, GST %, Price</b> (optional: Unit, Reorder level). Existing SKUs are updated.</p>
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
