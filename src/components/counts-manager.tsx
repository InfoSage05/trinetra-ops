"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { approveStockCountAction, discardStockCountAction, submitStockCountAction } from "@/actions/inventory";
import { callAction } from "@/lib/client/call-action";
import { formatQuantity } from "@/lib/money";
import { formatDateIN } from "@/lib/time";
import { toPieces } from "@/lib/cartons";

type Item = { id: string; name: string; sku: string | null; qtyPerCarton: number };
type Pending = { id: string; productName: string; countedQuantity: string; expectedQuantity: string; delta: string; countedAt: Date; movementsSinceCount: number; note: string | null };

export function CountsManager({ items, pending, isOwner }: { items: Item[]; pending: Pending[]; isOwner: boolean }) {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [cartonsCounted, setCartonsCounted] = useState("");
  const [looseCounted, setLooseCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = items.find((i) => i.id === productId);
  // An empty or unreadable box must not be saved as "counted 0".
  const hasCount = [cartonsCounted, looseCounted].some((v) => v.trim() !== "") && [cartonsCounted, looseCounted].every((v) => v.trim() === "" || /^\d+(\.\d{1,2})?$/.test(v.trim()));
  const countedPieces = toPieces(cartonsCounted, looseCounted, selected?.qtyPerCarton ?? 1);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const ok = await callAction(submitStockCountAction({ productId, countedQuantity: countedPieces, note }), { success: isOwner ? "Count saved. Approve it below." : "Count sent to the owner" });
    setBusy(false);
    if (ok) { setCartonsCounted(""); setLooseCounted(""); setNote(""); router.refresh(); }
  }

  return (
    <div className="space-y-6">
      <h1>Count stock</h1>
      <Card>
        <CardHeader><CardTitle>Enter what you physically counted</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid gap-3">
            <div className="space-y-1">
              <Label htmlFor="item">Item</Label>
              <select id="item" className="h-12 w-full rounded-lg border border-input bg-card px-3 outline-none focus-visible:border-ring" value={productId} onChange={(e) => setProductId(e.target.value)} required>
                <option value="">Choose item…</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name}{i.sku ? ` (${i.sku})` : ""}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label htmlFor="cartonsCounted">Full cartons counted</Label><Input id="cartonsCounted" className="h-14 text-2xl" inputMode="decimal" value={cartonsCounted} onChange={(e) => setCartonsCounted(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="looseCounted">Loose pieces counted</Label><Input id="looseCounted" className="h-14 text-2xl" inputMode="decimal" value={looseCounted} onChange={(e) => setLooseCounted(e.target.value)} /></div>
            </div>
            {selected && <p className="text-sm">1 carton = {selected.qtyPerCarton} pieces. Total counted: <b>{countedPieces}</b> pieces.</p>}
            <div className="space-y-1"><Label htmlFor="note">Note (optional)</Label><Input id="note" className="h-11" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <Button type="submit" size="lg" className="h-12" disabled={busy || !productId || !hasCount}>Save count</Button>
          </form>
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader><CardTitle>Waiting for your approval ({pending.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {pending.map((c) => (
              <div key={c.id} className="rounded-lg bg-muted/50 p-3">
                <p className="font-medium">{c.productName}</p>
                <p className="text-sm">Counted {formatQuantity(c.countedQuantity)}, system showed {formatQuantity(c.expectedQuantity)}: change <b>{Number(c.delta) > 0 ? "+" : ""}{formatQuantity(c.delta)}</b> · {formatDateIN(new Date(c.countedAt))}</p>
                {c.note && <p className="text-sm text-muted-foreground">“{c.note}”</p>}
                {c.movementsSinceCount > 0 && (
                  <p className="rounded-lg bg-warning/10 px-2 py-1.5 text-sm text-warning-foreground">{c.movementsSinceCount} stock change(s) were recorded after this count. Approving applies only the difference found when counting.</p>
                )}
                <div className="mt-2 flex gap-2">
                  <Button onClick={async () => { if (await callAction(approveStockCountAction({ stockCountId: c.id }), { success: "Stock updated" })) router.refresh(); }}>Approve</Button>
                  <Button variant="outline" onClick={async () => { if (await callAction(discardStockCountAction({ stockCountId: c.id }), { success: "Count discarded" })) router.refresh(); }}>Discard</Button>
                </div>
              </div>
            ))}
            {pending.length === 0 && <p className="text-muted-foreground">Nothing waiting.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
