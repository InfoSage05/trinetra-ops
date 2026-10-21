"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CustomerPicker } from "@/components/customer-picker";
import { ProductPicker, type BillableProduct } from "@/components/product-picker";
import { StateSelect } from "@/components/state-select";
import { StockBar, StockPanel } from "@/components/stock-panel";
import type { SavedCustomer } from "@/components/customer-dialog";
import { createBillAction, previewBillAction } from "@/actions/billing";
import type { Plain } from "@/lib/action-result";
import type { BillPreview } from "@/domain/billing";
import { useIdempotencyKey } from "@/lib/client/use-idempotency-key";
import { splitCartons, toPieces } from "@/lib/cartons";
import { D, amountInWords, formatINR, formatQuantity } from "@/lib/money";

type Line = { rowId: number; productId: string; cartons: string; loosePieces: string; unitPrice: string; discountAmount: string };
type PayMode = "FULL" | "PART" | "CREDIT";
type ChargeKey = "CARTON" | "CRATE" | "FREIGHT";
const METHODS = [
  { value: "CASH", label: "Cash" }, { value: "UPI", label: "UPI" }, { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" }, { value: "CARD", label: "Card" },
];
const CHARGE_FIELDS: { kind: ChargeKey; label: string }[] = [
  { kind: "CARTON", label: "Total carton charges" }, { kind: "CRATE", label: "Extra crate charges" }, { kind: "FREIGHT", label: "Freight charges" },
];

let nextRowId = 1;
const blankLine = (productId = ""): Line => ({ rowId: nextRowId++, productId, cartons: "", loosePieces: "", unitPrice: "", discountAmount: "" });

/** Total pieces on a line; 0 while the fields are empty or not yet a valid number. */
function linePieces(line: Line, product: BillableProduct | undefined): string {
  if (!product) return "0";
  try { return toPieces(line.cartons, line.loosePieces, product.qtyPerCarton); } catch { return "0"; }
}

type Props = {
  products: BillableProduct[]; businessStateCode: string; initialCustomer?: SavedCustomer | null; initialProductId?: string;
  /** A pending order being billed: its id and what is still to be delivered, in pieces. */
  order?: { id: string; lines: { productId: string; pieces: string }[] };
};

export function BillForm({ products, businessStateCode, initialCustomer = null, initialProductId, order }: Props) {
  const router = useRouter();
  const [key, renewKey] = useIdempotencyKey();
  const [customer, setCustomer] = useState<SavedCustomer | null>(initialCustomer);
  const [placeOfSupply, setPlaceOfSupply] = useState(initialCustomer?.stateCode ?? businessStateCode);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>(() => {
    const fromOrder = (order?.lines ?? []).flatMap((l) => {
      const product = products.find((p) => p.id === l.productId);
      if (!product) return [];
      const { cartons, pieces } = splitCartons(l.pieces, product.qtyPerCarton);
      return [{ ...blankLine(product.id), cartons: String(cartons), loosePieces: pieces ? String(pieces) : "" }];
    });
    return fromOrder.length > 0 ? fromOrder : [blankLine(initialProductId)];
  });
  const [charges, setCharges] = useState<Record<ChargeKey, string>>({ CARTON: "", CRATE: "", FREIGHT: "" });
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [fetched, setFetched] = useState<{ json: string; data: Plain<BillPreview> | null; error: string | null } | null>(null);
  const [payMode, setPayMode] = useState<PayMode>("FULL");
  const [paidAmount, setPaidAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [confirmText, setConfirmText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const productOf = (l: Line) => products.find((p) => p.id === l.productId);
  // A line counts once it has an item and a quantity; half-filled rows must not make the preview error out.
  const filledLines = lines.filter((l) => l.productId && D(linePieces(l, productOf(l))).greaterThan(0));
  const draft = {
    customerId: customer?.id ?? "",
    placeOfSupply,
    ...(deliveryAddress.trim() ? { deliveryAddress: deliveryAddress.trim() } : {}),
    ...(notes.trim() ? { notes: notes.trim() } : {}),
    lines: filledLines.map((l) => ({
      productId: l.productId,
      cartons: l.cartons.trim() || "0",
      ...(l.loosePieces.trim() ? { loosePieces: l.loosePieces.trim() } : {}),
      ...(l.unitPrice ? { unitPrice: l.unitPrice } : {}),
      ...(l.discountAmount ? { discountAmount: l.discountAmount } : {}),
    })),
    charges: CHARGE_FIELDS.filter((c) => charges[c.kind].trim() !== "" && Number(charges[c.kind]) !== 0).map((c) => ({ kind: c.kind, amount: charges[c.kind].trim() })),
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

  // The stock panel follows the line being worked on, falling back to the last line that has an item.
  const activeLine = lines.find((l) => l.rowId === activeRow && l.productId) ?? [...lines].reverse().find((l) => l.productId);
  const activeProduct = activeLine ? productOf(activeLine) : undefined;
  const takingNow = activeProduct
    ? lines.filter((l) => l.productId === activeProduct.id).reduce((sum, l) => sum.plus(linePieces(l, activeProduct)), D(0)).toString()
    : "0";
  const stockNow = preview?.lines.find((l) => l.productId === activeProduct?.id)?.availableBefore ?? activeProduct?.stock;

  async function save(confirmShortfall: boolean) {
    if (!customer) return toast.error("Choose a customer first.");
    if (filledLines.length === 0) return toast.error("Add at least one item with its cartons.");
    if (!preview) return toast.error(previewError ?? "Please wait for the total to update.");
    if (preview.hasShortfall && !confirmShortfall) {
      return setConfirmText(preview.lines.filter((l) => l.shortfallQuantity).map((l) => `${l.productName}: short by ${formatQuantity(l.shortfallQuantity!)}`).join("\n"));
    }
    const amount = payMode === "FULL" ? preview.grandTotal : payMode === "PART" ? paidAmount : "";
    setSaving(true);
    let result;
    try {
      result = await createBillAction({
        ...draft, idempotencyKey: key, confirmShortfall, ...(order ? { orderId: order.id } : {}),
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
    <div className="pb-44 lg:pb-28">
      <h1 className="mb-4 text-xl font-semibold">New bill</h1>
      {order && <p className="mb-4 rounded-md bg-muted p-2 text-sm">Billing a pending order. The items below are what is still to be delivered. Change them if you are sending less.</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <Card><CardContent className="space-y-3 pt-6">
            <Label>Name of the purchaser</Label>
            <CustomerPicker value={customer} defaultStateCode={businessStateCode} onSelect={(c) => { setCustomer(c); setPlaceOfSupply(c.stateCode); }} />
            {customer && (
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2" data-testid="purchaser-details">
                <div><dt className="inline text-muted-foreground">Mobile no: </dt><dd className="inline">{customer.phone ?? "-"}</dd></div>
                <div><dt className="inline text-muted-foreground">GST no: </dt><dd className="inline">{customer.gstin ?? "Unregistered"}</dd></div>
                <div className="sm:col-span-2"><dt className="inline text-muted-foreground">Address: </dt><dd className="inline">{customer.billingAddress}</dd></div>
              </dl>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pos">Goods delivered to (place of supply)</Label>
              <StateSelect id="pos" value={placeOfSupply} onChange={setPlaceOfSupply} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delivery">Delivery address (leave empty if same as customer address)</Label>
              <Input id="delivery" className="h-11" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
            </div>
          </CardContent></Card>

          {lines.map((line, index) => {
            const product = productOf(line);
            const pieces = linePieces(line, product);
            const previewIndex = filledLines.findIndex((l) => l.rowId === line.rowId);
            const pl = previewIndex >= 0 ? preview?.lines[previewIndex] : undefined;
            return (
              <Card key={line.rowId} data-testid="bill-line" onFocusCapture={() => { setActiveRow(line.rowId); }}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Sl no {index + 1}</span>
                    {lines.length > 1 && <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((l) => l.rowId !== line.rowId))}>Remove</Button>}
                  </div>
                  <ProductPicker products={products} value={line.productId} onSelect={(p) => { update(line.rowId, { productId: p.id, unitPrice: "" }); setActiveRow(line.rowId); }} />
                  {product && (
                    <>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="space-y-1"><Label>No of cartons</Label><Input aria-label="Cartons" className="h-12 text-lg" inputMode="decimal" value={line.cartons} onChange={(e) => update(line.rowId, { cartons: e.target.value })} /></div>
                        <div className="space-y-1"><Label>Extra pieces</Label><Input aria-label="Extra pieces" className="h-12 text-lg" inputMode="decimal" placeholder="0" value={line.loosePieces} onChange={(e) => update(line.rowId, { loosePieces: e.target.value })} /></div>
                        <div className="space-y-1"><Label>Qty per carton</Label><p className="flex h-12 items-center rounded-md bg-muted px-3" data-testid="qty-per-carton">{product.qtyPerCarton}</p></div>
                        <div className="space-y-1"><Label>Total qty</Label><p className="flex h-12 items-center rounded-md bg-muted px-3 font-semibold" data-testid="total-qty">{formatQuantity(pieces)} {product.unit}</p></div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="space-y-1"><Label>Rate</Label><Input aria-label="Rate" className="h-12" inputMode="decimal" placeholder={product.unitPrice} value={line.unitPrice} onChange={(e) => update(line.rowId, { unitPrice: e.target.value })} /></div>
                        <div className="space-y-1"><Label>Discount ₹</Label><Input aria-label="Discount" className="h-12" inputMode="decimal" placeholder="0" value={line.discountAmount} onChange={(e) => update(line.rowId, { discountAmount: e.target.value })} /></div>
                        <div className="space-y-1"><Label>GST</Label><p className="flex h-12 items-center rounded-md bg-muted px-3">{formatQuantity(product.gstRate)}%</p></div>
                        <div className="space-y-1"><Label>Total amount</Label><p className="flex h-12 items-center rounded-md bg-muted px-3 font-semibold" data-testid="line-total">{pl ? formatINR(pl.lineTotal) : "-"}</p></div>
                      </div>
                      {pl?.shortfallQuantity && <p className="text-sm text-destructive">Short by {formatQuantity(pl.shortfallQuantity)} {product.unit}. Check the stock box.</p>}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
          <Button variant="outline" className="h-12 w-full" onClick={() => setLines([...lines, blankLine()])}>+ Add another item</Button>

          <Card><CardContent className="space-y-3 pt-6">
            <Label>Extra charges (leave empty if none)</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {CHARGE_FIELDS.map((c) => (
                <div key={c.kind} className="space-y-1">
                  <Label htmlFor={`charge-${c.kind}`} className="text-sm">{c.label}</Label>
                  <Input id={`charge-${c.kind}`} className="h-12" inputMode="decimal" placeholder="0.00" value={charges[c.kind]} onChange={(e) => setCharges({ ...charges, [c.kind]: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Note on the bill (optional)</Label>
              <Input id="notes" className="h-11" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardContent></Card>

          {previewError && <p className="text-sm text-destructive">{previewError}</p>}

          {preview && (
            <Card><CardContent className="space-y-1 pt-6 text-sm" data-testid="bill-totals">
              <Row label="Taxable value (items + charges)" value={formatINR(preview.taxableTotal)} />
              {preview.interState
                ? <Row label="IGST" value={formatINR(preview.igstTotal)} />
                : <><Row label="CGST" value={formatINR(preview.cgstTotal)} /><Row label="SGST" value={formatINR(preview.sgstTotal)} /></>}
              <Row label="Round off" value={formatINR(preview.roundOff)} />
              <div className="flex justify-between pt-2 text-xl font-semibold"><span>Grand total</span><span>{formatINR(preview.grandTotal)}</span></div>
              <p className="pt-1 text-muted-foreground">{amountInWords(preview.grandTotal)}</p>
              {preview.charges.length > 0 && <p className="pt-1 text-xs text-muted-foreground">Charges are taxed at {formatQuantity(preview.charges[0].gstRate)}% (the highest rate among the items).</p>}
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
        </div>

        {/* Stock check: a sticky card beside the form on a laptop; on a phone a slim bar sits above the Save button. */}
        <aside className="hidden lg:sticky lg:top-4 lg:block lg:self-start">
          <StockPanel product={activeProduct} availableNow={stockNow} takingNow={takingNow} others={products} />
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 space-y-2 border-t bg-background p-3">
        <div className="mx-auto max-w-5xl lg:hidden"><StockBar product={activeProduct} availableNow={stockNow} takingNow={takingNow} /></div>
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
