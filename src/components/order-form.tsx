"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LinesEditor, blankLine, linesReady, piecesOf, toEditable, type CatalogueItem, type EditableLine } from "@/components/proposal-lines";
import { VoiceRecorder } from "@/components/voice-recorder";
import { createOrderAction, proposeOrderAction, proposeOrderFromImageAction } from "@/actions/orders";
import { callAction } from "@/lib/client/call-action";
import { useIdempotencyKey } from "@/lib/client/use-idempotency-key";
import { shrinkImage } from "@/lib/client/shrink-image";

type Props = {
  customers: { id: string; name: string }[];
  catalogue: CatalogueItem[];
  voiceAvailable: boolean;
  aiAvailable: boolean;
  visionAvailable: boolean;
  initialCustomerId?: string;
};

type Draft = {
  channel: "MANUAL" | "TEXT" | "VOICE" | "IMAGE"; extractor: string | null; model: string | null; sourceText: string; notes: string[];
  customerId: string; dueDate: string; lines: EditableLine[];
};

export function OrderForm({ customers, catalogue, voiceAvailable, aiAvailable, visionAvailable, initialCustomerId = "" }: Props) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fromVoice, setFromVoice] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [orderNote, setOrderNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [photoCustomer, setPhotoCustomer] = useState(initialCustomerId);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
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

  async function readPhotos(files: FileList | null) {
    const chosen = Array.from(files ?? []);
    if (chosen.length === 0) return;
    if (chosen.length > 5) return toast.error("Choose at most 5 photos at a time.");
    setBusy(true);
    const form = new FormData();
    for (const file of chosen) form.append("image", await shrinkImage(file));
    if (photoCustomer) form.set("customerId", photoCustomer);
    const p = await callAction(proposeOrderFromImageAction(form));
    setBusy(false);
    if (photoInput.current) photoInput.current.value = "";
    if (cameraInput.current) cameraInput.current.value = "";
    if (!p) return;
    setDraft({
      channel: "IMAGE", extractor: p.extractor, model: p.model, sourceText: p.sourceText, notes: p.notes,
      customerId: p.customer.id ?? photoCustomer, dueDate: p.dueDate ?? "", lines: toEditable(p.lines),
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
        <section className="space-y-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]">
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

        <section className="space-y-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]">
          <h2 className="font-semibold">Upload a photo of the order</h2>
          {visionAvailable ? (
            <>
              <p className="text-sm text-muted-foreground">A photo or screenshot of a handwritten or printed order. It is turned into an order for you to check; nothing is saved until you press Save order.</p>
              <div className="space-y-1.5">
                <Label htmlFor="photo-customer">Whose order is it? (optional, the photo may say)</Label>
                <select id="photo-customer" className="h-12 w-full rounded-lg border border-input bg-card px-2.5 outline-none focus-visible:border-ring" value={photoCustomer} onChange={(e) => setPhotoCustomer(e.target.value)}>
                  <option value="">Read it from the photo</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" className="h-12" disabled={busy} onClick={() => cameraInput.current?.click()}>Take a photo</Button>
                <Button type="button" variant="outline" className="h-12" disabled={busy} onClick={() => photoInput.current?.click()}>Insert images</Button>
              </div>
              <p className="text-xs text-muted-foreground">&quot;Insert images&quot; lets you pick pictures already saved on this phone or computer. You can pick up to 5 pages of the same order.</p>
              <input ref={cameraInput} type="file" hidden accept="image/png,image/jpeg,image/webp" capture="environment" aria-label="Take order photo" onChange={(e) => readPhotos(e.target.files)} />
              <input ref={photoInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" aria-label="Insert order images" onChange={(e) => readPhotos(e.target.files)} />
              {busy && <p className="text-sm text-muted-foreground">Reading…</p>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Photo reading is not switched on yet. It needs an AI model that can see pictures; see <b>docs/keys.md</b> (LLM_VISION_MODEL).</p>
          )}
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
      {draft.notes.map((n) => <p key={n} className="rounded-lg bg-warning/15 p-2 text-sm text-warning-foreground">{n}</p>)}
      <div className="space-y-1.5">
        <Label htmlFor="order-customer">Customer</Label>
        <select id="order-customer" className="h-12 w-full rounded-lg border border-input bg-card px-2.5 outline-none focus-visible:border-ring" value={draft.customerId} onChange={(e) => setDraft({ ...draft, customerId: e.target.value })}>
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
