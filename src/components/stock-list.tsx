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

type Row = { id: string; sku: string | null; name: string; unit: string; qtyPerCarton: number; stock: string; reorderLevel: string; status: "NEGATIVE" | "LOW" | "OK" };
type Mode = { kind: "produce" | "adjust"; row: Row } | null;

export function StockList({ rows, canAdjust }: { rows: Row[]; canAdjust: boolean }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<Mode>(null);
  const [cartons, setCartons] = useState("");
  const [loose, setLoose] = useState("");
  const [change, setChange] = useState("");
  const [reason, setReason] = useState("");
  const [key, renewKey] = useIdempotencyKey();
  const [busy, setBusy] = useState(false);
  const visible = rows.filter((r) => `${r.name} ${r.sku ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  async function submit() {
    if (!mode || busy) return;
    setBusy(true);
    const pending = mode.kind === "produce"
      ? recordProductionAction({ productId: mode.row.id, quantity: toPieces(cartons, loose, mode.row.qtyPerCarton), idempotencyKey: key })
      : adjustStockAction({ productId: mode.row.id, quantityDelta: change, reason, idempotencyKey: key });
    const ok = await callAction(pending, { success: mode.kind === "produce" ? "Production added" : "Stock corrected" });
    setBusy(false);
    if (ok) {
      renewKey(); setMode(null); setCartons(""); setLoose(""); setChange(""); setReason(""); router.refresh();
    }
  }

  const producePieces = mode?.kind === "produce" ? toPieces(cartons, loose, mode.row.qtyPerCarton) : "0";

  return (
    <div className="space-y-3">
      <Input placeholder="Search item" className="h-11" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ul className="divide-y divide-border/80 rounded-xl bg-card ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]">
        {visible.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 p-3">
            <div className="mr-auto">
              <Link href={`/inventory/${r.id}`} className="font-medium underline-offset-2 hover:underline">{r.name}</Link>
              <p className="text-sm text-muted-foreground">{r.sku ? `${r.sku} · ` : ""}<CartonSize key={`${r.id}-${r.qtyPerCarton}`} id={r.id} name={r.name} value={r.qtyPerCarton} unit={r.unit} editable={canAdjust} /></p>
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
                <div className="space-y-1">
                  <Label>Change in pieces (use minus to reduce, e.g. -3)</Label>
                  <Input aria-label="Change in pieces" className="h-14 text-2xl" autoFocus value={change} onChange={(e) => setChange(e.target.value)} />
                </div>
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
