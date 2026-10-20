"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Plain } from "@/lib/action-result";
import type { InvoiceView } from "@/domain/invoice-view";
import { recordPaymentAction, recordReturnAction, retryIrpAction } from "@/actions/bills";
import { callAction } from "@/lib/client/call-action";
import { useIdempotencyKey } from "@/lib/client/use-idempotency-key";
import { D, formatINR, formatQuantity } from "@/lib/money";
import { invoiceShareText, whatsappShareUrl } from "@/lib/share";

const METHODS = [
  { value: "CASH", label: "Cash" }, { value: "UPI", label: "UPI" }, { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" }, { value: "CARD", label: "Card" },
];
const linkButton = (variant: "outline" | "default" = "outline") => buttonVariants({ variant });

export function BillActions({ view }: { view: Plain<InvoiceView> }) {
  const router = useRouter();
  const [payOpen, setPayOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [payKey, renewPayKey] = useIdempotencyKey();
  const [returnKey, renewReturnKey] = useIdempotencyKey();
  const [amount, setAmount] = useState(view.payment.amountDue);
  const [method, setMethod] = useState("CASH");
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});

  const returned = new Map<string, number>();
  for (const note of view.creditNotes) for (const l of note.lines) returned.set(l.billLineItemId, (returned.get(l.billLineItemId) ?? 0) + Number(l.quantity));

  const share = whatsappShareUrl(view.customer.phone, invoiceShareText({
    supplierName: view.supplier.name, invoiceNumber: view.invoiceNumber, invoiceDate: view.invoiceDate,
    grandTotal: view.totals.grandTotal, amountDue: view.payment.amountDue, upiPayUri: view.upiPayUri,
  }));

  async function pay() {
    const ok = await callAction(recordPaymentAction({ billId: view.id, amount, method, idempotencyKey: payKey }), { success: "Payment recorded" });
    if (ok) { renewPayKey(); setPayOpen(false); router.refresh(); }
  }

  async function doReturn() {
    const lines = Object.entries(returnQty).filter(([, q]) => q && Number(q) > 0).map(([billLineItemId, quantity]) => ({ billLineItemId, quantity }));
    const ok = await callAction(recordReturnAction({ billId: view.id, reason, restock, lines, idempotencyKey: returnKey }), { success: "Credit note created" });
    if (ok) { renewReturnKey(); setReturnOpen(false); setReturnQty({}); setReason(""); router.refresh(); }
  }

  const due = D(view.payment.amountDue);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">{view.invoiceNumber}</h1>
        <Badge variant={view.payment.status === "PAID" ? "secondary" : "destructive"}>
          {view.payment.status === "PAID" ? "Paid" : `Due ${formatINR(view.payment.amountDue)}`}
        </Badge>
        {view.irp && <Badge variant={view.irp.status === "ACCEPTED" ? "secondary" : "outline"}>e-Invoice: {view.irp.status.toLowerCase()}</Badge>}
      </div>
      <div className="flex flex-wrap gap-2">
        {due.greaterThan(0) && <Button onClick={() => { setAmount(view.payment.amountDue); setPayOpen(true); }}>Record payment</Button>}
        <Button variant="outline" onClick={() => setReturnOpen(true)}>Return items</Button>
        <a className={linkButton()} href={`/print/bills/${view.id}?format=a4`} target="_blank" rel="noreferrer">Print A4</a>
        <a className={linkButton()} href={`/print/bills/${view.id}?format=thermal`} target="_blank" rel="noreferrer">Print receipt</a>
        <a className={linkButton()} href={`/api/bills/${view.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
        <a className={linkButton()} href={share} target="_blank" rel="noreferrer">WhatsApp</a>
        {view.irp && (view.irp.status === "FAILED" || view.irp.status === "REJECTED") && (
          <Button variant="destructive" onClick={async () => { if (await callAction(retryIrpAction({ submissionId: view.irp!.submissionId, billId: view.id }), { success: "Queued for retry" })) router.refresh(); }}>Retry e-invoice</Button>
        )}
      </div>
      {view.irp?.lastError && <p className="text-sm text-destructive">e-Invoice problem: {view.irp.lastError}</p>}
      {view.creditNotes.length > 0 && (
        <p className="text-sm text-muted-foreground">Credit notes: {view.creditNotes.map((n) => `${n.number} (${formatINR(n.grandTotal)})`).join(", ")}</p>
      )}

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1"><Label>Amount (due {formatINR(view.payment.amountDue)})</Label><Input className="h-12 text-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <Select items={METHODS} value={method} onValueChange={(v) => { if (v) setMethod(v); }}>
              <SelectTrigger className="h-12 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="lg" onClick={pay}>Save payment</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Return items (credit note)</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            {view.lines.map((l) => {
              const left = Number(l.quantity) - (returned.get(l.id) ?? 0);
              return (
                <div key={l.id} className="flex items-center gap-2">
                  <span className="flex-1 text-sm">{l.productName} <span className="text-muted-foreground">(can return {formatQuantity(String(left))})</span></span>
                  <Input className="h-11 w-24" inputMode="decimal" disabled={left <= 0} value={returnQty[l.id] ?? ""} onChange={(e) => setReturnQty({ ...returnQty, [l.id]: e.target.value })} />
                </div>
              );
            })}
            <div className="space-y-1"><Label>Reason</Label><Input className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. broken in transit" /></div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={restock} onCheckedChange={(v) => setRestock(v === true)} /> Put returned items back into stock (untick if damaged)</label>
            <Button size="lg" onClick={doReturn}>Create credit note</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
