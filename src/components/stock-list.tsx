"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adjustStockAction, recordProductionAction } from "@/actions/inventory";
import { callAction } from "@/lib/client/call-action";
import { useIdempotencyKey } from "@/lib/client/use-idempotency-key";
import { formatQuantity } from "@/lib/money";

type Row = { id: string; sku: string; name: string; unit: string; stock: string; reorderLevel: string; status: "NEGATIVE" | "LOW" | "OK" };
type Mode = { kind: "produce" | "adjust"; row: Row } | null;

export function StockList({ rows, canAdjust }: { rows: Row[]; canAdjust: boolean }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<Mode>(null);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [key, renewKey] = useIdempotencyKey();
  const visible = rows.filter((r) => `${r.name} ${r.sku}`.toLowerCase().includes(search.toLowerCase()));

  async function submit() {
    if (!mode) return;
    const pending = mode.kind === "produce"
      ? recordProductionAction({ productId: mode.row.id, quantity: qty, idempotencyKey: key })
      : adjustStockAction({ productId: mode.row.id, quantityDelta: qty, reason, idempotencyKey: key });
    if (await callAction(pending, { success: mode.kind === "produce" ? "Production added" : "Stock corrected" })) {
      renewKey(); setMode(null); setQty(""); setReason(""); router.refresh();
    }
  }

  return (
    <div className="space-y-3">
      <Input placeholder="Search item" className="h-11" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ul className="divide-y rounded-md border bg-background">
        {visible.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 p-3">
            <div className="mr-auto">
              <p className="font-medium">{r.name}</p>
              <p className="text-sm text-muted-foreground">{r.sku}</p>
            </div>
            <span className="text-lg font-semibold">{formatQuantity(r.stock)} <span className="text-sm font-normal">{r.unit}</span></span>
            {r.status === "NEGATIVE" && <Badge variant="destructive">Oversold</Badge>}
            {r.status === "LOW" && <Badge className="bg-amber-500">Low</Badge>}
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
            <div className="space-y-1">
              <Label>{mode?.kind === "produce" ? "How many were made?" : "Change (use minus to reduce, e.g. -3)"}</Label>
              <Input className="h-14 text-2xl" inputMode={mode?.kind === "produce" ? "decimal" : "text"} autoFocus value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            {mode?.kind === "adjust" && (
              <div className="space-y-1"><Label>Reason (required)</Label><Input className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. broken, miscounted" /></div>
            )}
            {mode?.kind === "produce" && <p className="text-xs text-muted-foreground">This adds finished candles to stock. It does not check raw materials.</p>}
            <Button size="lg" className="h-12" onClick={submit}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
