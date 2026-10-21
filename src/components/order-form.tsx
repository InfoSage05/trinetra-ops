"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LinesEditor, blankLine, linesReady, piecesOf, toEditable, type CatalogueItem, type EditableLine } from "@/components/proposal-lines";
import { VoiceRecorder } from "@/components/voice-recorder";
import { createOrderAction, proposeOrderAction } from "@/actions/orders";
import { callAction } from "@/lib/client/call-action";
import { useIdempotencyKey } from "@/lib/client/use-idempotency-key";

type Props = {
  customers: { id: string; name: string }[];
  catalogue: CatalogueItem[];
  voiceAvailable: boolean;
  aiAvailable: boolean;
  initialCustomerId?: string;
};

type Draft = {
  channel: "MANUAL" | "TEXT" | "VOICE"; extractor: string | null; model: string | null; sourceText: string; notes: string[];
  customerId: string; dueDate: string; lines: EditableLine[];
};

export function OrderForm({ customers, catalogue, voiceAvailable, aiAvailable, initialCustomerId = "" }: Props) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fromVoice, setFromVoice] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [orderNote, setOrderNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, renewKey] = useIdempotencyKey();

  async function check() {
    setBusy(true);
    const p = await callAction(proposeOrderAction({ text }));
    setBusy(false);
    if (!p) return;
    setDraft({
      channel: fromVoice ? "VOICE" : "TEXT", extractor: p.extractor, model: p.model, sourceText: p.sourceText, notes: p.notes,
      customerId: p.customer.id ?? initialCustomerId, dueDate: p.dueDate ?? "", lines: toEditable(p.lines),
    });
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    const order = await callAction(createOrderAction({
      customerId: draft.customerId, dueDate: draft.dueDate, notes: orderNote,
      source: draft.channel, sourceText: draft.sourceText,
      sourceMetadata: draft.channel === "MANUAL" ? undefined : { extractor: draft.extractor, model: draft.model },
      lines: draft.lines.map((l) => ({ productId: l.productId, quantity: piecesOf(l, catalogue) })),
      idempotencyKey: key,
    }));
    setBusy(false);
    if (!order) return;
    renewKey();
    toast.success("Order saved");
    router.push(`/orders/${order.id}`);
  }

  if (!draft) {
    return (
      <div className="space-y-4">
        <section className="space-y-2 rounded-md border bg-background p-4">
          <h2 className="font-semibold">Say or type the order</h2>
          <p className="text-sm text-muted-foreground">
            For example: “Sharma Traders, 5 carton rose, 3 carton birthday, by 5 Nov”. {aiAvailable ? "The AI assistant reads it." : "Simple matching reads it (no AI key set)."}
          </p>
          <Textarea aria-label="The order" rows={4} value={text} onChange={(e) => { setText(e.target.value); setFromVoice(false); }} />
          <div className="flex flex-wrap gap-2">
            {voiceAvailable && <VoiceRecorder onText={(t) => { setText(t); setFromVoice(true); }} />}
            <Button className="h-12" disabled={busy || text.trim().length < 3} onClick={check}>{busy ? "Checking…" : "Check"}</Button>
            <Button variant="outline" className="h-12" onClick={() => setDraft({ channel: "MANUAL", extractor: null, model: null, sourceText: "", notes: [], customerId: initialCustomerId, dueDate: "", lines: [blankLine()] })}>
              Fill in by hand
            </Button>
          </div>
        </section>
      </div>
    );
  }

  const ready = draft.customerId !== "" && draft.dueDate !== "" && linesReady(draft.lines, catalogue);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {draft.channel === "MANUAL" ? "Fill in the order." : `${draft.extractor === "LLM" ? "Read by the AI assistant." : "Read by simple matching."} Check everything. Nothing is saved until you press Save order.`}
      </p>
      {draft.notes.map((n) => <p key={n} className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">{n}</p>)}
      <div className="space-y-1.5">
        <Label htmlFor="order-customer">Customer</Label>
        <select id="order-customer" className="h-12 w-full rounded-md border bg-background px-2" value={draft.customerId} onChange={(e) => setDraft({ ...draft, customerId: e.target.value })}>
          <option value="">Choose customer…</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="order-due">Needed by</Label>
        <Input id="order-due" type="date" className="h-12" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
      </div>
      <LinesEditor lines={draft.lines} catalogue={catalogue} onChange={(lines) => setDraft({ ...draft, lines })} />
      <Button variant="outline" onClick={() => setDraft({ ...draft, lines: [...draft.lines, blankLine()] })}>+ Add an item</Button>
      <div className="space-y-1.5">
        <Label htmlFor="order-note">Note (optional)</Label>
        <Input id="order-note" className="h-11" value={orderNote} onChange={(e) => setOrderNote(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-14" onClick={() => setDraft(null)}>Start again</Button>
        <Button className="h-14" disabled={!ready || busy} onClick={save}>Save order</Button>
      </div>
    </div>
  );
}
