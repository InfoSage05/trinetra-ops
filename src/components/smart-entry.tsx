"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LinesEditor, blankLine, linesReady, piecesOf, toEditable, type CatalogueItem, type EditableLine } from "@/components/proposal-lines";
import { VoiceRecorder } from "@/components/voice-recorder";
import { OrderForm } from "@/components/order-form";
import { applyStockProposalAction, proposeSheetAction, proposeStockUpdateAction } from "@/actions/assistant";
import type { Plain } from "@/lib/action-result";
import type { StockProposal } from "@/domain/ai-stock";
import { callAction } from "@/lib/client/call-action";
import { useIdempotencyKey } from "@/lib/client/use-idempotency-key";

type Props = { catalogue: CatalogueItem[]; voiceAvailable: boolean; aiAvailable: boolean; canApproveCounts: boolean; canCreateOrders: boolean; visionAvailable: boolean; customers: { id: string; name: string }[] };
type Reviewing = { kind: StockProposal["kind"]; channel: "TEXT" | "VOICE" | "SHEET"; extractor: StockProposal["extractor"]; model: string | null; sourceText: string; notes: string[]; lines: EditableLine[] };

/** Type, speak or upload; check what was understood; press Approve. Nothing is saved before Approve. */
export function SmartEntry({ catalogue, voiceAvailable, aiAvailable, canApproveCounts, canCreateOrders, visionAvailable, customers }: Props) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fromVoice, setFromVoice] = useState(false);
  const [reviewing, setReviewing] = useState<Reviewing | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, renewKey] = useIdempotencyKey();
  const fileInput = useRef<HTMLInputElement>(null);

  function open(p: Plain<StockProposal>, channel: Reviewing["channel"]) {
    setReviewing({ kind: p.kind, channel, extractor: p.extractor, model: p.model, sourceText: p.sourceText, notes: p.notes, lines: toEditable(p.lines) });
  }

  async function check() {
    setBusy(true);
    const p = await callAction(proposeStockUpdateAction({ text }));
    setBusy(false);
    if (p) open(p, fromVoice ? "VOICE" : "TEXT");
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    const p = await callAction(proposeSheetAction(form));
    setBusy(false);
    if (fileInput.current) fileInput.current.value = "";
    if (p) open(p, "SHEET");
  }

  async function approve() {
    if (!reviewing) return;
    setBusy(true);
    const result = await callAction(applyStockProposalAction({
      kind: reviewing.kind, channel: reviewing.channel, extractor: reviewing.extractor, model: reviewing.model, sourceText: reviewing.sourceText,
      lines: reviewing.lines.map((l) => ({ productId: l.productId, pieces: piecesOf(l, catalogue) })), idempotencyKey: key,
    }));
    setBusy(false);
    if (!result) return;
    renewKey();
    const skipped = result.skipped.length ? ` ${result.skipped.length} skipped: ${result.skipped.map((s) => s.reason).join(" ")}` : "";
    toast.success(reviewing.kind === "PRODUCTION" ? `Added to stock: ${result.saved} item(s).${skipped}` : `${result.saved} count(s) sent for the owner to approve.${skipped}`);
    setReviewing(null); setText(""); setFromVoice(false);
    router.refresh();
  }

  if (reviewing) {
    const ready = linesReady(reviewing.lines, catalogue, reviewing.kind === "COUNT");
    return (
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">{reviewing.kind === "PRODUCTION" ? "Check what was made" : "Check the counted stock"}</h2>
        <p className="text-sm text-muted-foreground">
          {reviewing.extractor === "LLM" ? "Read by the AI assistant." : "Read by simple matching."} Nothing is saved until you press the button below.
          {reviewing.kind === "COUNT" && !canApproveCounts && " The owner will approve these counts."}
        </p>
        {reviewing.notes.map((n) => <p key={n} className="rounded-lg bg-warning/15 p-2 text-sm text-warning-foreground">{n}</p>)}
        <LinesEditor lines={reviewing.lines} catalogue={catalogue} onChange={(lines) => setReviewing({ ...reviewing, lines })} />
        <Button variant="outline" onClick={() => setReviewing({ ...reviewing, lines: [...reviewing.lines, blankLine()] })}>+ Add an item</Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-14" onClick={() => setReviewing(null)}>Cancel</Button>
          <Button className="h-14" disabled={!ready || busy} onClick={approve}>{reviewing.kind === "PRODUCTION" ? "Approve and add to stock" : "Approve and send counts"}</Button>
        </div>
        {!ready && <p className="text-sm text-destructive">Every row needs an item and a quantity.</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]">
        <h2 className="font-semibold">Tell me what was made</h2>
        <p className="text-sm text-muted-foreground">For example: “rose candle 5 carton, birthday 3 carton, masjid 120 pcs”. {aiAvailable ? "The AI assistant reads it." : "Simple matching reads it (no AI key set)."}</p>
        <Textarea aria-label="What was made" rows={4} value={text} onChange={(e) => { setText(e.target.value); setFromVoice(false); }} placeholder="rose candle 5 carton, birthday 3 carton" />
        <div className="flex flex-wrap gap-2">
          {voiceAvailable && <VoiceRecorder onText={(t) => { setText(t); setFromVoice(true); }} />}
          <Button className="h-12" disabled={busy || text.trim().length < 2} onClick={check}>{busy ? "Checking…" : "Check"}</Button>
        </div>
      </section>

      <section className="space-y-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]">
        <h2 className="font-semibold">Upload a stock sheet</h2>
        <p className="text-sm text-muted-foreground">Any Excel or CSV list of items and quantities. It becomes counts that the owner approves, so stock is never changed by mistake.</p>
        <input ref={fileInput} type="file" accept=".xlsx,.csv" aria-label="Stock sheet" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} className="block w-full text-sm" />
      </section>

      {/* Owner only: the same photo → order flow as New order, so a photographed order becomes a real order right here. */}
      {canCreateOrders && (
        <OrderForm customers={customers} catalogue={catalogue} voiceAvailable={false} aiAvailable={aiAvailable} visionAvailable={visionAvailable} channels={["IMAGE"]} />
      )}
    </div>
  );
}
