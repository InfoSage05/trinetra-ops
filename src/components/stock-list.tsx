"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CartonSize } from "@/components/carton-size";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adjustStockAction, recordProductionAction } from "@/actions/inventory";
import { callAction } from "@/lib/client/call-action";
import { useIdempotencyKey } from "@/lib/client/use-idempotency-key";
import { describeStock, toPieces } from "@/lib/cartons";

type Row = { id: string; sku: string | null; name: string; size: string | null; categoryId: string | null; categoryName: string | null; unit: string; qtyPerCarton: number; stock: string; reorderLevel: string; status: "NEGATIVE" | "LOW" | "OK" };
type Mode = { kind: "produce" | "adjust"; row: Row } | null;

export function StockList({ rows, canAdjust }: { rows: Row[]; canAdjust: boolean }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const categories = [...new Map(rows.filter((r) => r.categoryId).map((r) => [r.categoryId!, r.categoryName!])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const [mode, setMode] = useState<Mode>(null);
  const [cartons, setCartons] = useState("");
  const [loose, setLoose] = useState("");
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [reason, setReason] = useState("");
  const [key, renewKey] = useIdempotencyKey();
  const [busy, setBusy] = useState(false);
  const needle = search.trim().toLowerCase();
  const visible = rows
    .filter((r) => `${r.name} ${r.size ?? ""} ${r.categoryName ?? ""} ${r.sku ?? ""}`.toLowerCase().includes(needle))
    .filter((r) => category === "" || (category === "none" ? r.categoryId === null : r.categoryId === category))
    .sort((a, b) => (a.categoryName ?? "~").localeCompare(b.categoryName ?? "~") || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  async function submit() {
    if (!mode || busy) return;
    setBusy(true);
    const pending = mode.kind === "produce"
      ? recordProductionAction({ productId: mode.row.id, quantity: toPieces(cartons, loose, mode.row.qtyPerCarton), idempotencyKey: key })
      : adjustStockAction({ productId: mode.row.id, quantityDelta: correctionPieces, reason, idempotencyKey: key });
    const ok = await callAction(pending, { success: mode.kind === "produce" ? "Production added" : "Stock corrected" });
    setBusy(false);
    if (ok) {
      renewKey(); setMode(null); setCartons(""); setLoose(""); setDirection("add"); setReason(""); router.refresh();
    }
  }

  // A correction is typed in cartons and/or pieces, as an addition or a removal; stock itself is kept in pieces.
  const correctionPieces = mode?.kind === "adjust" ? `${direction === "remove" ? "-" : ""}${toPieces(cartons, loose, mode.row.qtyPerCarton)}` : "0";
  const producePieces = mode?.kind === "produce" ? toPieces(cartons, loose, mode.row.qtyPerCarton) : "0";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Search item, size or category" className="h-11 min-w-0 flex-1 basis-60" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Show category" className="h-11 rounded-lg border border-input bg-card px-2.5" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          <option value="none">Not in any category</option>
        </select>
      </div>
      <ul className="divide-y divide-border/80 rounded-xl bg-card ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]">
        {visible.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 p-3">
            <div className="mr-auto">
              <Link href={`/inventory/${r.id}`} className="font-medium underline-offset-2 hover:underline">{r.name}</Link>{r.size && <span className="ml-2 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground" data-testid="size-badge">Size {r.size}</span>}
              <p className="text-sm text-muted-foreground">{r.categoryName ? `${r.categoryName} · ` : ""}{r.sku ? `${r.sku} · ` : ""}<CartonSize key={`${r.id}-${r.qtyPerCarton}`} id={r.id} name={r.name} value={r.qtyPerCarton} unit={r.unit} editable={canAdjust} /></p>
            </div>
            <span className="text-right text-sm font-semibold">{describeStock(r.stock, r.qtyPerCarton)}</span>
            {r.status === "NEGATIVE" && <Badge variant="destructive">Oversold</Badge>}
            {r.status === "LOW" && <Badge variant="warning">Low</Badge>}
            <Button size="sm" onClick={() => setMode({ kind: "produce", row: r })}>+ Made</Button>
            {canAdjust && <Button size="sm" variant="outline" onClick={() => setMode({ kind: "adjust", row: r })}>Correct</Button>}
          </li>
        ))}
        {visible.length === 0 && <li className="p-6 text-center text-muted-foreground">No items.</li>}
      </ul>

      <Dialog open={mode !== null} onOpenChange={(open) => { if (!open) setMode(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{mode?.kind === "produce" ? `Add production: ${mode.row.name}` : `Correct stock: ${mode?.row.name}`}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            {mode?.kind === "produce" ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1"><Label>Cartons made</Label><Input aria-label="Cartons made" className="h-14 text-2xl" inputMode="decimal" autoFocus value={cartons} onChange={(e) => setCartons(e.target.value)} /></div>
                  <div className="space-y-1"><Label>Extra pieces</Label><Input aria-label="Extra pieces" className="h-14 text-2xl" inputMode="decimal" value={loose} onChange={(e) => setLoose(e.target.value)} /></div>
                </div>
                <p className="text-sm">1 carton = {mode.row.qtyPerCarton} pieces. This adds <b>{producePieces}</b> pieces to stock.</p>
                <p className="text-xs text-muted-foreground">This adds finished candles to stock. It does not check raw materials.</p>
              </>
            ) : (
              <>
                <div role="group" aria-label="Add or take out" className="grid grid-cols-2 gap-2">
                  <Button type="button" variant={direction === "add" ? "default" : "outline"} className="h-12" aria-pressed={direction === "add"} onClick={() => setDirection("add")}>Add to stock</Button>
                  <Button type="button" variant={direction === "remove" ? "default" : "outline"} className="h-12" aria-pressed={direction === "remove"} onClick={() => setDirection("remove")}>Take out of stock</Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1"><Label>Cartons</Label><Input aria-label="Cartons to change" className="h-14 text-2xl" inputMode="decimal" autoFocus value={cartons} onChange={(e) => setCartons(e.target.value)} /></div>
                  <div className="space-y-1"><Label>Extra pieces</Label><Input aria-label="Pieces to change" className="h-14 text-2xl" inputMode="decimal" value={loose} onChange={(e) => setLoose(e.target.value)} /></div>
                </div>
                <p className="text-sm" data-testid="correction-total">1 carton = {(mode?.row.qtyPerCarton ?? 1)} pieces. This {direction === "remove" ? "takes out" : "adds"} <b>{toPieces(cartons, loose, (mode?.row.qtyPerCarton ?? 1))}</b> pieces.</p>
                <div className="space-y-1"><Label>Reason (required)</Label><Input className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. broken, miscounted" /></div>
              </>
            )}
            <Button size="lg" className="h-12" disabled={busy} onClick={submit}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
