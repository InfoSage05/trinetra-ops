"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CustomerPicker } from "@/components/customer-picker";
import { ProductPicker, type BillableProduct } from "@/components/product-picker";
import { StateSelect } from "@/components/state-select";
import type { SavedCustomer } from "@/components/customer-dialog";
import { createBillAction, previewBillAction } from "@/actions/billing";
import type { Plain } from "@/lib/action-result";
import type { BillPreview } from "@/domain/billing";
import { useIdempotencyKey } from "@/lib/client/use-idempotency-key";
import { formatINR, formatQuantity } from "@/lib/money";

type Line = { rowId: number; productId: string; quantity: string; unitPrice: string; discountAmount: string };
type PayMode = "FULL" | "PART" | "CREDIT";
const METHODS = [
  { value: "CASH", label: "Cash" }, { value: "UPI", label: "UPI" }, { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" }, { value: "CARD", label: "Card" },
];

let nextRowId = 1;
const blankLine = (): Line => ({ rowId: nextRowId++, productId: "", quantity: "1", unitPrice: "", discountAmount: "" });

export function BillForm({ products, businessStateCode }: { products: BillableProduct[]; businessStateCode: string }) {
  const router = useRouter();
  const [key, renewKey] = useIdempotencyKey();
  const [customer, setCustomer] = useState<SavedCustomer | null>(null);
  const [placeOfSupply, setPlaceOfSupply] = useState(businessStateCode);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);
  const [fetched, setFetched] = useState<{ json: string; data: Plain<BillPreview> | null; error: string | null } | null>(null);
  const [payMode, setPayMode] = useState<PayMode>("FULL");
  const [paidAmount, setPaidAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [confirmText, setConfirmText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filledLines = lines.filter((l) => l.productId);
  const draft = {
    customerId: customer?.id ?? "",
    placeOfSupply,
    ...(deliveryAddress.trim() ? { deliveryAddress: deliveryAddress.trim() } : {}),
    ...(notes.trim() ? { notes: notes.trim() } : {}),
    lines: filledLines.map((l) => ({
      productId: l.productId, quantity: l.quantity,
      ...(l.unitPrice ? { unitPrice: l.unitPrice } : {}),
      ...(l.discountAmount ? { discountAmount: l.discountAmount } : {}),
    })),
  };
  const draftJson = JSON.stringify(draft);

  // Live, authoritative totals and stock from the server (debounced).
  // Only trust a preview computed for exactly the current draft; an older one may show stale totals.
  const current = fetched?.json === draftJson ? fetched : null;
  const preview = current?.data ?? null;
  const previewError = current?.error ?? null;
  useEffect(() => {
    const parsed = JSON.parse(draftJson) as { customerId: string; lines: unknown[] };
    if (!parsed.customerId || parsed.lines.length === 0) return;
    const timer = setTimeout(async () => {
      const result = await previewBillAction(parsed);
      setFetched(result.ok ? { json: draftJson, data: result.data, error: null } : { json: draftJson, data: null, error: result.error });
    }, 400);
    return () => clearTimeout(timer);
  }, [draftJson]);

  const update = (rowId: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.rowId === rowId ? { ...l, ...patch } : l)));

  async function save(confirmShortfall: boolean) {
    if (!customer) return toast.error("Choose a customer first.");
    if (filledLines.length === 0) return toast.error("Add at least one item.");
    if (!preview) return toast.error(previewError ?? "Please wait for the total to update.");
    if (preview.hasShortfall && !confirmShortfall) {
      return setConfirmText(preview.lines.filter((l) => l.shortfallQuantity).map((l) => `${l.productName}: short by ${formatQuantity(l.shortfallQuantity!)}`).join("\n"));
    }
    const amount = payMode === "FULL" ? preview.grandTotal : payMode === "PART" ? paidAmount : "";
    setSaving(true);
    let result;
    try {
      result = await createBillAction({
        ...draft, idempotencyKey: key, confirmShortfall,
        ...(amount && Number(amount) > 0 ? { initialPayment: { amount, method } } : {}),
      });
    } catch {
      // The request may or may not have reached the server. The same key is reused on the next press,
      // so pressing Save again can never create a second invoice.
      setSaving(false);
      return toast.error("Could not reach the server. Check the internet and press Save again. Your bill will not be duplicated.");
    }
    setSaving(false);
    if (result.ok) {
      renewKey();
      toast.success(`Bill ${result.data.invoiceNumber} saved`);
      router.push(`/bills/${result.data.id}`);
    } else if (result.code === "SHORTFALL_NOT_CONFIRMED") {
      setConfirmText(result.error); // stock changed since the preview
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="space-y-4 pb-28">
      <h1 className="text-xl font-semibold">New bill</h1>

      <Card><CardContent className="space-y-3 pt-6">
        <Label>Customer</Label>
        <CustomerPicker value={customer} defaultStateCode={businessStateCode} onSelect={(c) => { setCustomer(c); setPlaceOfSupply(c.stateCode); }} />
        <div className="space-y-1.5">
          <Label htmlFor="pos">Goods delivered to (place of supply)</Label>
          <StateSelect id="pos" value={placeOfSupply} onChange={setPlaceOfSupply} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="delivery">Delivery address (leave empty if same as customer address)</Label>
          <Input id="delivery" className="h-11" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes">Note on the bill (optional)</Label>
          <Input id="notes" className="h-11" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </CardContent></Card>

      {lines.map((line, index) => {
        const product = products.find((p) => p.id === line.productId);
        const previewIndex = filledLines.findIndex((l) => l.rowId === line.rowId);
        const pl = previewIndex >= 0 ? preview?.lines[previewIndex] : undefined;
        const available = pl ? pl.availableBefore : product?.stock;
        return (
          <Card key={line.rowId}><CardContent className="space-y-3 pt-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Item {index + 1}</span>
              {lines.length > 1 && <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((l) => l.rowId !== line.rowId))}>Remove</Button>}
            </div>
            <ProductPicker products={products} value={line.productId} onSelect={(p) => update(line.rowId, { productId: p.id, unitPrice: "" })} />
            {product && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={pl?.shortfallQuantity ? "destructive" : "secondary"} className="text-sm">
                    In stock: {formatQuantity(available ?? "0")} {product.unit}
                  </Badge>
                  {pl?.shortfallQuantity && <span className="text-sm text-destructive">Short by {formatQuantity(pl.shortfallQuantity)}</span>}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1"><Label>Qty</Label><Input aria-label="Quantity" className="h-12 text-lg" inputMode="decimal" value={line.quantity} onChange={(e) => update(line.rowId, { quantity: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Price</Label><Input aria-label="Price" className="h-12" inputMode="decimal" placeholder={product.unitPrice} value={line.unitPrice} onChange={(e) => update(line.rowId, { unitPrice: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Discount ₹</Label><Input aria-label="Discount" className="h-12" inputMode="decimal" placeholder="0" value={line.discountAmount} onChange={(e) => update(line.rowId, { discountAmount: e.target.value })} /></div>
                </div>
                {pl && <p className="text-right text-sm">Line total {formatINR(pl.lineTotal)} <span className="text-muted-foreground">(GST {formatQuantity(pl.gstRate)}%)</span></p>}
              </>
            )}
          </CardContent></Card>
        );
      })}
      <Button variant="outline" className="h-12 w-full" onClick={() => setLines([...lines, blankLine()])}>+ Add another item</Button>

      {previewError && <p className="text-sm text-destructive">{previewError}</p>}

      {preview && (
        <Card><CardContent className="space-y-1 pt-6 text-sm">
          <Row label="Taxable value" value={formatINR(preview.taxableTotal)} />
          {preview.interState
            ? <Row label="IGST" value={formatINR(preview.igstTotal)} />
            : <><Row label="CGST" value={formatINR(preview.cgstTotal)} /><Row label="SGST" value={formatINR(preview.sgstTotal)} /></>}
          <Row label="Round off" value={formatINR(preview.roundOff)} />
          <div className="flex justify-between pt-2 text-xl font-semibold"><span>Total</span><span>{formatINR(preview.grandTotal)}</span></div>
        </CardContent></Card>
      )}

      <Card><CardContent className="space-y-3 pt-6">
        <Label>Payment</Label>
        <div className="grid grid-cols-3 gap-2">
          {([["FULL", "Paid fully"], ["PART", "Part paid"], ["CREDIT", "On credit"]] as const).map(([mode, label]) => (
            <Button key={mode} variant={payMode === mode ? "default" : "outline"} className="h-12" onClick={() => setPayMode(mode)}>{label}</Button>
          ))}
        </div>
        {payMode !== "CREDIT" && (
          <div className="grid grid-cols-2 gap-2">
            {payMode === "PART" && <Input className="h-12" inputMode="decimal" placeholder="Amount received" value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)} />}
            <Select items={METHODS} value={method} onValueChange={(v) => { if (v) setMethod(v); }}>
              <SelectTrigger className="h-12 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
      </CardContent></Card>

      <div className="fixed inset-x-0 bottom-0 border-t bg-background p-3">
        <Button size="lg" className="mx-auto flex h-14 w-full max-w-5xl text-lg" disabled={saving} onClick={() => save(false)}>
          {saving ? "Saving…" : preview ? `Save bill · ${formatINR(preview.grandTotal)}` : "Save bill"}
        </Button>
      </div>

      <AlertDialog open={confirmText !== null} onOpenChange={(open) => { if (!open) setConfirmText(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Not enough stock</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">{confirmText}{"\n\n"}Bill anyway? The shortfall is recorded as still owed to the customer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmText(null); void save(true); }}>Bill anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span>{value}</span></div>;
}
