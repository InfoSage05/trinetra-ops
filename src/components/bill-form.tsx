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
import { BillSheet } from "@/components/bill-sheet";
import { GstSummary } from "@/components/gst-summary";
import { CHARGE_FIELDS, QTY_UNITS, blankLine, fromPieces, linePieces, rememberUnit, type Charges, type Line, type QtyUnit } from "@/components/bill-lines";
import { RATE_TIERS, RATE_TIER_LABELS, rateFor, type RateTier } from "@/lib/rates";
import type { SavedCustomer } from "@/components/customer-dialog";
import { createBillAction, previewBillAction } from "@/actions/billing";
import type { Plain } from "@/lib/action-result";
import type { BillPreview } from "@/domain/billing";
import { useIdempotencyKey } from "@/lib/client/use-idempotency-key";
import { useBillLayout } from "@/lib/client/use-bill-layout";
import { useSheetPrefs } from "@/lib/client/use-sheet-prefs";
import { MAX_BILL_ITEMS } from "@/lib/limits";
import { D, amountInWords, formatINR, formatQuantity } from "@/lib/money";

type PayMode = "FULL" | "PART" | "CREDIT";
const METHODS = [
  { value: "CASH", label: "Cash" }, { value: "UPI", label: "UPI" }, { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" }, { value: "CARD", label: "Card" },
];

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
  // Which of the three rates this bill uses; it starts from the customer's own rate type and can be changed.
  const [rateTier, setRateTier] = useState<RateTier>(initialCustomer?.rateTier ?? "B");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>(() => {
    const fromOrder = (order?.lines ?? []).flatMap((l) => {
      const product = products.find((p) => p.id === l.productId);
      if (!product) return [];
      return [{ ...blankLine(product.id), ...fromPieces(l.pieces, product.qtyPerCarton) }];
    });
    return fromOrder.length > 0 ? fromOrder : [blankLine(initialProductId)];
  });
  const [charges, setCharges] = useState<Charges>({ CARTON: "", CRATE: "", FREIGHT: "" });
  const [layout, setLayout] = useBillLayout();
  const [sheetPrefs, setSheetPrefs] = useSheetPrefs();
  // The full-width sheet needs the whole row, so the side stock panel gives way to the one-line stock bar.
  const sideStock = layout === "cards" || !sheetPrefs.wide;
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [fetched, setFetched] = useState<{ json: string; data: Plain<BillPreview> | null; error: string | null } | null>(null);
  const [payMode, setPayMode] = useState<PayMode>("FULL");
  const [paidAmount, setPaidAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [confirmText, setConfirmText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const productOf = (l: Line) => products.find((p) => p.id === l.productId);
  const pieceCount = (l: Line) => linePieces(l, productOf(l));
  // A line counts once it has an item and a quantity; half-filled rows must not make the preview error out.
  const filledLines = lines.filter((l) => l.productId && D(pieceCount(l)).greaterThan(0));
  const draft = {
    customerId: customer?.id ?? "",
    placeOfSupply,
    rateTier,
    ...(deliveryAddress.trim() ? { deliveryAddress: deliveryAddress.trim() } : {}),
    ...(notes.trim() ? { notes: notes.trim() } : {}),
    lines: filledLines.map((l) => ({
      productId: l.productId,
      quantity: pieceCount(l), // whatever unit it was typed in (cartons, dozens, pieces), the bill is worked out in pieces
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
  // The sheet addresses rows by position; a row that does not exist yet is created when it is first typed in.
  const editAt = (index: number, patch: Partial<Line>) => {
    if (index >= MAX_BILL_ITEMS) return toast.error(`A bill can have at most ${MAX_BILL_ITEMS} items. Make a second bill for the rest.`);
    setLines((ls) => {
      const next = [...ls];
      while (next.length <= index) next.push(blankLine());
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };
  const clearAt = (index: number) => setLines((ls) => (ls.length <= 1 ? [blankLine()] : ls.filter((_, i) => i !== index)));

  // The stock panel follows the line being worked on, falling back to the last line that has an item.
  const activeLine = (activeIndex !== null && lines[activeIndex]?.productId ? lines[activeIndex] : undefined) ?? [...lines].reverse().find((l) => l.productId);
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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto">New bill</h1>
        <div role="group" aria-label="Bill layout" className="inline-flex rounded-lg bg-muted p-1 shadow-[inset_0_1px_2px_rgb(64_38_16/0.06)]">
          <button type="button" aria-pressed={layout === "cards"} onClick={() => setLayout("cards")} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${layout === "cards" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Cards</button>
          <button type="button" aria-pressed={layout === "sheet"} onClick={() => setLayout("sheet")} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${layout === "sheet" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>Excel sheet</button>
        </div>
      </div>
      {order && <p className="mb-4 rounded-xl bg-info/10 px-3.5 py-2.5 text-sm text-info-foreground ring-1 ring-info/20" data-testid="order-banner">Billing a pending order. The items below are what is still to be delivered. Change them if you are sending less.</p>}
      <div className={`grid gap-4 ${sideStock ? "lg:grid-cols-[minmax(0,1fr)_20rem]" : "grid-cols-[minmax(0,1fr)]"}`}>
        <div className="space-y-4">
          <Card><CardContent className="space-y-3 pt-6">
            <Label>Name of the purchaser</Label>
            <CustomerPicker value={customer} defaultStateCode={businessStateCode} onSelect={(c) => { setCustomer(c); setPlaceOfSupply(c.stateCode); setRateTier(c.rateTier); }} />
            {customer && (
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2" data-testid="purchaser-details">
                <div><dt className="inline text-muted-foreground">Mobile no: </dt><dd className="inline">{customer.phone ?? "-"}</dd></div>
                <div><dt className="inline text-muted-foreground">GST no: </dt><dd className="inline">{customer.gstin ?? "Unregistered"}</dd></div>
                <div className="sm:col-span-2"><dt className="inline text-muted-foreground">Address: </dt><dd className="inline">{customer.billingAddress}</dd></div>
              </dl>
            )}
            <div className="space-y-1.5" data-testid="rate-tier">
              <Label>Rate for this bill</Label>
              <div role="group" aria-label="Rate for this bill" className="grid grid-cols-3 gap-2">
                {RATE_TIERS.map((t) => (
                  <Button key={t} type="button" variant={rateTier === t ? "default" : "outline"} className="h-12" aria-pressed={rateTier === t} onClick={() => setRateTier(t)}>
                    {RATE_TIER_LABELS[t]}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Starts from the customer&apos;s own rate. Items use this rate unless you type a different one on the line.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pos">Goods delivered to (place of supply)</Label>
              <StateSelect id="pos" value={placeOfSupply} onChange={setPlaceOfSupply} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delivery">Delivery address (leave empty if same as customer address)</Label>
              <Input id="delivery" className="h-11" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
            </div>
          </CardContent></Card>

          {layout === "sheet" ? (
            <BillSheet
              products={products} lines={lines} filledLines={filledLines} preview={preview}
              charges={charges} onCharges={setCharges} onEdit={editAt} onClear={clearAt} onActivate={setActiveIndex}
              rateTier={rateTier} prefs={sheetPrefs} onPrefs={setSheetPrefs}
            />
          ) : (
            <>
          {lines.map((line, index) => {
            const product = productOf(line);
            const pieces = linePieces(line, product);
            const previewIndex = filledLines.findIndex((l) => l.rowId === line.rowId);
            const pl = previewIndex >= 0 ? preview?.lines[previewIndex] : undefined;
            return (
              <Card key={line.rowId} data-testid="bill-line" onFocusCapture={() => setActiveIndex(index)}>
                <CardContent className="space-y-3 pt-6">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Sl no {index + 1}</span>
                    {lines.length > 1 && <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((l) => l.rowId !== line.rowId))}>Remove</Button>}
                  </div>
                  <ProductPicker products={products} value={line.productId} onSelect={(p) => { update(line.rowId, { productId: p.id, unitPrice: "" }); setActiveIndex(index); }} />
                  {product && (
                    <>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="space-y-1"><Label>Quantity</Label><Input aria-label="Quantity" className="h-12 text-lg" inputMode="decimal" value={line.qty} onChange={(e) => update(line.rowId, { qty: e.target.value })} /></div>
                        <div className="space-y-1">
                          <Label>Unit</Label>
                          <select aria-label="Unit" className="h-12 w-full rounded-lg border border-input bg-card px-2.5 text-lg outline-none focus-visible:border-ring" value={line.unit} onChange={(e) => { rememberUnit(e.target.value as QtyUnit); update(line.rowId, { unit: e.target.value as QtyUnit }); }}>
                            {QTY_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1"><Label>Qty per carton</Label><p className="flex h-12 items-center rounded-md bg-muted px-3" data-testid="qty-per-carton">{product.qtyPerCarton}</p></div>
                        <div className="space-y-1"><Label>Total qty</Label><p className="flex h-12 items-center rounded-md bg-muted px-3 font-semibold" data-testid="total-qty">{formatQuantity(pieces)} {product.unit}</p></div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="space-y-1"><Label>Rate</Label><Input aria-label="Rate" className="h-12" inputMode="decimal" placeholder={formatQuantity(rateFor(product, rateTier))} value={line.unitPrice} onChange={(e) => update(line.rowId, { unitPrice: e.target.value })} /></div>
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
          <Button variant="outline" className="h-12 w-full" disabled={lines.length >= MAX_BILL_ITEMS} onClick={() => setLines([...lines, blankLine()])}>{lines.length >= MAX_BILL_ITEMS ? `Most items on one bill reached (${MAX_BILL_ITEMS})` : "+ Add another item"}</Button>
            </>
          )}

          <GstSummary preview={preview} />

          <Card><CardContent className="space-y-3 pt-6">
            {layout === "cards" && (
              <>
                <Label>Extra charges (leave empty if none)</Label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {CHARGE_FIELDS.map((c) => (
                    <div key={c.kind} className="space-y-1">
                      <Label htmlFor={`charge-${c.kind}`} className="text-sm">{c.label}</Label>
                      <Input id={`charge-${c.kind}`} className="h-12" inputMode="decimal" placeholder="0.00" value={charges[c.kind]} onChange={(e) => setCharges({ ...charges, [c.kind]: e.target.value })} />
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="notes">Note on the bill (optional)</Label>
              <Input id="notes" className="h-11" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </CardContent></Card>

          {previewError && <p className="text-sm text-destructive">{previewError}</p>}

          {preview && layout === "cards" && (
            <Card><CardContent className="space-y-1 pt-6 text-sm" data-testid="bill-totals">
              <Row label="Taxable value (items + charges)" value={formatINR(preview.taxableTotal)} />
              {preview.interState
                ? <Row label="IGST" value={formatINR(preview.igstTotal)} />
                : <><Row label="CGST" value={formatINR(preview.cgstTotal)} /><Row label="SGST" value={formatINR(preview.sgstTotal)} /></>}
              <Row label="Round off" value={formatINR(preview.roundOff)} />
              <div className="flex justify-between pt-2 text-xl font-semibold"><span>Grand total</span><span>{formatINR(preview.grandTotal)}</span></div>
              <p className="pt-1 text-muted-foreground">{amountInWords(preview.grandTotal)}</p>
              {preview.charges.length > 0 && <p className="pt-1 text-xs text-muted-foreground">Charges are taxed at {formatQuantity(preview.charges[0].gstRate)}% (the highest rate among the items). Confirm this rate with your CA.</p>}
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
        <aside className={sideStock ? "hidden lg:sticky lg:top-4 lg:block lg:self-start" : "hidden"}>
          <StockPanel product={activeProduct} availableNow={stockNow} takingNow={takingNow} others={products} />
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 space-y-2 border-t border-border/80 bg-background/85 p-3 backdrop-blur-md [box-shadow:0_-10px_32px_-16px_rgb(64_38_16/0.22)]">
        <div className={`mx-auto max-w-5xl ${sideStock ? "lg:hidden" : ""}`}><StockBar product={activeProduct} availableNow={stockNow} takingNow={takingNow} /></div>
        <Button size="lg" className="mx-auto flex h-14 w-full max-w-5xl text-lg font-semibold shadow-[0_10px_30px_-10px_color-mix(in_oklab,var(--color-primary)_65%,transparent)]" disabled={saving} onClick={() => save(false)}>
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
