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
import { cartonsAndUnitToPieces, describeStockInUnit, unitQuantityToPieces } from "@/lib/cartons";
import { cartonQuantityInUnit, cartonQuantityText, stockUnitLabel, type StockMode, type StockUnit } from "@/lib/stock-units";

type Row = { id: string; sku: string | null; name: string; size: string | null; categoryId: string | null; categoryName: string | null; unit: string; qtyPerCarton: number; stockUnit: StockUnit; stockMode: StockMode; stock: string; reorderLevel: string; status: "NEGATIVE" | "LOW" | "OK" };
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

  function openStockDialog(kind: "produce" | "adjust", row: Row) {
    setCartons(""); setLoose(""); setDirection("add"); setReason(""); setMode({ kind, row });
  }

  async function submit() {
    if (!mode || busy) return;
    setBusy(true);
    const pending = mode.kind === "produce"
      ? recordProductionAction({ productId: mode.row.id, quantity: producePieces, idempotencyKey: key })
      : adjustStockAction({ productId: mode.row.id, quantityDelta: correctionPieces, reason, idempotencyKey: key });
    const ok = await callAction(pending, { success: mode.kind === "produce" ? "Production added" : "Stock corrected" });
    setBusy(false);
    if (ok) {
      renewKey(); setMode(null); setCartons(""); setLoose(""); setDirection("add"); setReason(""); router.refresh();
    }
  }

  // A correction is typed in cartons and/or pieces, as an addition or a removal; stock itself is kept in pieces.
  const enteredPieces = mode ? (mode.row.stockMode === "UNIT_ONLY"
    ? unitQuantityToPieces(cartons, mode.row.stockUnit)
    : cartonsAndUnitToPieces(cartons, loose, mode.row.qtyPerCarton, mode.row.stockUnit)) : "0";
  const correctionPieces = mode?.kind === "adjust" ? `${direction === "remove" ? "-" : ""}${enteredPieces}` : "0";
  const producePieces = mode?.kind === "produce" ? enteredPieces : "0";
  const stockLabel = mode ? stockUnitLabel(mode.row.stockUnit) : "units";

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
              <p className="text-sm text-muted-foreground">{r.categoryName ? `${r.categoryName} · ` : ""}{r.sku ? `${r.sku} · ` : ""}<CartonSize key={`${r.id}-${r.qtyPerCarton}-${r.stockUnit}-${r.stockMode}`} id={r.id} name={r.name} value={r.qtyPerCarton} stockUnit={r.stockUnit} stockMode={r.stockMode} editable={canAdjust} /></p>
            </div>
            <span className="text-right text-sm font-semibold">{describeStockInUnit(r.stock, r.qtyPerCarton, r.stockUnit, r.stockMode)}</span>
            {r.status === "NEGATIVE" && <Badge variant="destructive">Oversold</Badge>}
            {r.status === "LOW" && <Badge variant="warning">Low</Badge>}
            <Button size="sm" onClick={() => openStockDialog("produce", r)}>+ Made</Button>
            {canAdjust && <Button size="sm" variant="outline" onClick={() => openStockDialog("adjust", r)}>Correct</Button>}
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
                {mode.row.stockMode === "UNIT_ONLY" ? (
                  <div className="space-y-1"><Label>Quantity made ({stockLabel})</Label><Input aria-label={`Quantity made in ${stockLabel}`} className="h-14 text-2xl" inputMode="decimal" autoFocus value={cartons} onChange={(e) => setCartons(e.target.value)} /></div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>Cartons made</Label><Input aria-label="Cartons made" className="h-14 text-2xl" inputMode="decimal" autoFocus value={cartons} onChange={(e) => setCartons(e.target.value)} /></div>
                    <div className="space-y-1"><Label>Extra {stockLabel}</Label><Input aria-label={`Extra ${stockLabel}`} className="h-14 text-2xl" inputMode="decimal" value={loose} onChange={(e) => setLoose(e.target.value)} /></div>
                  </div>
                )}
                <p className="text-sm">{mode.row.stockMode === "UNIT_ONLY" ? `Stock is tracked in ${stockUnitLabel(mode.row.stockUnit)} only.` : `1 carton = ${cartonQuantityText(mode.row.qtyPerCarton, mode.row.stockUnit)} ${stockUnitLabel(mode.row.stockUnit, cartonQuantityInUnit(mode.row.qtyPerCarton, mode.row.stockUnit))}.`} This adds <b>{describeStockInUnit(producePieces, mode.row.qtyPerCarton, mode.row.stockUnit, mode.row.stockMode)}</b> to stock.</p>
                <p className="text-xs text-muted-foreground">This adds finished candles to stock. It does not check raw materials.</p>
              </>
            ) : (
              <>
                <div role="group" aria-label="Add or take out" className="grid grid-cols-2 gap-2">
                  <Button type="button" variant={direction === "add" ? "default" : "outline"} className="h-12" aria-pressed={direction === "add"} onClick={() => setDirection("add")}>Add to stock</Button>
                  <Button type="button" variant={direction === "remove" ? "default" : "outline"} className="h-12" aria-pressed={direction === "remove"} onClick={() => setDirection("remove")}>Take out of stock</Button>
                </div>
                {mode?.row.stockMode === "UNIT_ONLY" ? (
                  <div className="space-y-1"><Label>Quantity to change ({stockLabel})</Label><Input aria-label={`Quantity to change in ${stockLabel}`} className="h-14 text-2xl" inputMode="decimal" autoFocus value={cartons} onChange={(e) => setCartons(e.target.value)} /></div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>Cartons</Label><Input aria-label="Cartons to change" className="h-14 text-2xl" inputMode="decimal" autoFocus value={cartons} onChange={(e) => setCartons(e.target.value)} /></div>
                    <div className="space-y-1"><Label>Extra {stockLabel}</Label><Input aria-label={`Extra ${stockLabel}`} className="h-14 text-2xl" inputMode="decimal" value={loose} onChange={(e) => setLoose(e.target.value)} /></div>
                  </div>
                )}
                <p className="text-sm" data-testid="correction-total">This {direction === "remove" ? "takes out" : "adds"} <b>{describeStockInUnit(correctionPieces.replace(/^-/, ""), mode?.row.qtyPerCarton ?? 1, mode?.row.stockUnit ?? "PIECE", mode?.row.stockMode ?? "CARTONS_AND_UNITS")}</b>.</p>
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
