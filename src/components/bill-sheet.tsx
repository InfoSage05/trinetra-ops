"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BillableProduct } from "@/components/product-picker";
import { CHARGE_FIELDS, QTY_UNITS, linePieces, rememberUnit, type Charges, type Line, type QtyUnit } from "@/components/bill-lines";
import { rateFor, type RateTier } from "@/lib/rates";
import type { Plain } from "@/lib/action-result";
import type { BillPreview } from "@/domain/billing";
import { D, amountInWords, formatAmount, formatQuantity } from "@/lib/money";
import { MAX_BILL_ITEMS } from "@/lib/limits";
import { MAX_ZOOM, MIN_ZOOM, type SheetPrefs } from "@/lib/client/use-sheet-prefs";

/**
 * The bill as a spreadsheet, laid out like the owner's Excel template. Keyboard works like Excel:
 * type an item name and press Enter, Tab to move right, Enter to go to the next row, arrows to move up and down.
 */

type Props = {
  products: BillableProduct[];
  lines: Line[];
  filledLines: Line[];
  preview: Plain<BillPreview> | null;
  charges: Charges;
  onCharges: (charges: Charges) => void;
  /** Changes row `index`; rows that do not exist yet are created. */
  onEdit: (index: number, patch: Partial<Line>) => void;
  onClear: (index: number) => void;
  onActivate: (index: number) => void;
  rateTier: RateTier;
  prefs: SheetPrefs;
  onPrefs: (change: Partial<SheetPrefs>) => void;
};

const NATURAL_WIDTH = 980; // the table is laid out this wide before zooming
const COL = { item: 0, quantity: 1, unit: 2, rate: 3, discount: 4 } as const;
const th = "border border-neutral-400 bg-neutral-100 px-1 py-1 text-center text-[11px] font-bold uppercase leading-tight";
const td = "border border-neutral-300 px-1 py-0 align-middle";
const num = `${td} text-right tabular-nums`;

function rank(products: BillableProduct[], query: string): BillableProduct[] {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const haystack = (p: BillableProduct) => `${p.name} ${p.sku ?? ""}`.toLowerCase();
  const hits = products.filter((p) => words.every((w) => haystack(p).includes(w)));
  const score = (p: BillableProduct) => (p.name.toLowerCase().startsWith(q) ? 0 : p.name.toLowerCase().includes(q) ? 1 : 2);
  return hits.sort((a, b) => score(a) - score(b));
}

function ItemCell({ product, products, dataCell, onPick, onNext, onFocusRow, onArrow }: {
  product: BillableProduct | undefined; products: BillableProduct[]; dataCell: string;
  onPick: (p: BillableProduct | null) => void; onNext: () => void; onFocusRow: () => void; onArrow: (delta: number) => void;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const matches = query !== null && query.trim() !== "" ? rank(products, query).slice(0, 8) : [];
  const measure = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setBox({ left: r.left, top: r.bottom, width: Math.max(r.width, 320) });
  };
  const pick = (p: BillableProduct) => { onPick(p); setQuery(null); };

  return (
    <>
      <input
        ref={ref} data-cell={dataCell} aria-label="Item" autoComplete="off" spellCheck={false}
        className="w-full bg-transparent px-1 py-1.5 outline-none focus:bg-yellow-50"
        value={query ?? product?.name ?? ""} placeholder="type item name"
        onFocus={(e) => { onFocusRow(); e.currentTarget.select(); }}
        onBlur={() => setQuery(null)}
        onChange={(e) => {
          setQuery(e.target.value); setHighlight(0); measure();
          if (e.target.value === "" && product) onPick(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (matches.length > 0) setHighlight((h) => (e.key === "ArrowDown" ? Math.min(h + 1, matches.length - 1) : Math.max(h - 1, 0)));
            else onArrow(e.key === "ArrowDown" ? 1 : -1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (matches.length > 0) { pick(matches[highlight]); onNext(); } else if (product) onNext();
          } else if (e.key === "Tab" && matches.length > 0) {
            pick(matches[highlight]); // focus then moves to the next cell by itself
          } else if (e.key === "Escape") {
            setQuery(null);
          }
        }}
      />
      {matches.length > 0 && box && createPortal(
        <ul role="listbox" className="fixed z-50 max-h-64 overflow-auto rounded-md border bg-background text-sm shadow-lg" style={{ left: box.left, top: box.top, width: box.width }}>
          {matches.map((p, i) => (
            <li
              key={p.id} role="option" aria-selected={i === highlight}
              className={`flex cursor-pointer justify-between gap-2 px-2 py-1.5 ${i === highlight ? "bg-yellow-100" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(p); onNext(); }}
            >
              <span>{p.name}{p.sku && <span className="text-muted-foreground"> ({p.sku})</span>}</span>
              <span className="whitespace-nowrap text-muted-foreground">₹{formatQuantity(p.unitPrice)} + GST {formatQuantity(p.gstRate)}%</span>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  );
}

export function BillSheet({ products, lines, filledLines, preview, charges, onCharges, onEdit, onClear, onActivate, rateTier, prefs, onPrefs }: Props) {
  const tableRef = useRef<HTMLTableElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [fitZoom, setFitZoom] = useState(100);
  const rowCount = Math.min(MAX_BILL_ITEMS, Math.max(prefs.rows, lines.length + 1));

  // "Fit" mode: scale the sheet so its whole width is on screen, so nobody has to scroll sideways.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setFitZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.floor((frame.clientWidth / NATURAL_WIDTH) * 100))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [prefs.wide]);
  const zoom = prefs.zoom === 0 ? fitZoom : prefs.zoom;
  const setZoom = (value: number) => onPrefs({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)) });

  const focusCell = (row: number, col: number) => {
    // A new row may still be rendering, so wait one tick.
    setTimeout(() => {
      const el = tableRef.current?.querySelector<HTMLInputElement>(`[data-cell="${row}:${col}"]`);
      el?.focus();
    }, 0);
  };
  const keys = (row: number, col: number) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); focusCell(row + 1, COL.item); }
    else if (e.key === "ArrowDown") { e.preventDefault(); focusCell(row + 1, col); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusCell(row - 1, col); }
  };

  const itemLines = preview?.lines ?? [];
  const sum = (pick: (l: (typeof itemLines)[number]) => string) => itemLines.reduce((s, l) => s.plus(D(pick(l))), D(0));
  const totalCartons = itemLines.reduce((s, l) => s.plus(D(l.cartons)), D(0));
  const totalQty = sum((l) => l.quantity);
  const interState = preview?.interState ?? false;

  const btn = "h-9 min-w-9 rounded-md border bg-background px-2 text-sm hover:bg-muted";
  return (
    <div
      // "Full width" lets the sheet use the whole screen even though the page is a narrower column. The extra 1.5rem
      // leaves room for a scroll bar so the page itself never starts to scroll sideways.
      style={prefs.wide ? { width: "calc(100vw - 3.5rem)", marginLeft: "calc(50% - 50vw + 1.75rem)" } : undefined}
      data-testid="bill-sheet-area"
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" data-testid="sheet-toolbar">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Size</span>
          <button type="button" aria-label="Make the sheet smaller" className={btn} onClick={() => setZoom(zoom - 10)}>−</button>
          <span className="w-12 text-center tabular-nums" data-testid="sheet-zoom">{zoom}%</span>
          <button type="button" aria-label="Make the sheet bigger" className={btn} onClick={() => setZoom(zoom + 10)}>+</button>
          <button type="button" className={`${btn} ${prefs.zoom === 0 ? "bg-primary text-primary-foreground hover:bg-primary" : ""}`} aria-pressed={prefs.zoom === 0} onClick={() => onPrefs({ zoom: 0 })}>Fit to screen</button>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={prefs.wide} onChange={(e) => onPrefs({ wide: e.target.checked })} /> Use the full width of the screen
        </label>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Rows</span>
          <button type="button" aria-label="Show fewer rows" className={btn} onClick={() => onPrefs({ rows: prefs.rows - 5 })} disabled={prefs.rows <= 6}>−5</button>
          <span className="w-8 text-center tabular-nums" data-testid="sheet-rows">{rowCount}</span>
          <button type="button" aria-label="Show more rows" className={btn} onClick={() => onPrefs({ rows: prefs.rows + 5 })} disabled={rowCount >= MAX_BILL_ITEMS}>+5</button>
          <span className="text-muted-foreground">(up to {MAX_BILL_ITEMS} items on a bill)</span>
        </div>
        <span className="text-xs text-muted-foreground">Tip: drag the bottom-right corner of the sheet to make it taller or wider.</span>
      </div>
    <div ref={frameRef} className="resize overflow-auto rounded-md border bg-background" style={{ minHeight: "12rem", maxHeight: "none" }} data-testid="bill-sheet">
      <div style={{ zoom: zoom / 100 }}>
      <table ref={tableRef} className="w-full border-collapse text-sm" style={{ minWidth: NATURAL_WIDTH }}>
        <colgroup>
          {[4, 21, 6, 7, 5, 6, 7, 5, 8, 7, 5, 8, 8, 8, 9, 3].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
        </colgroup>
        <thead>
          <tr>
            {["Sl no", "Description of goods", "HSN", "No of cartons", "Qty per carton", "Quantity", "Unit", "Total qty", "Rate", "Discount ₹", "GST %", "CGST", "SGST", "IGST", "Total amount", ""].map((h, i) => <th key={i} className={th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }, (_, i) => {
            const line = lines[i];
            const product = line ? products.find((p) => p.id === line.productId) : undefined;
            const filledIndex = line ? filledLines.findIndex((l) => l.rowId === line.rowId) : -1;
            const pl = filledIndex >= 0 ? preview?.lines[filledIndex] : undefined;
            const pieces = linePieces(line, product);
            const cell = (name: keyof typeof COL) => `${i}:${COL[name]}`;
            return (
              <tr key={i} data-testid="sheet-row" onFocusCapture={() => onActivate(i)}>
                <td className={`${td} text-center text-muted-foreground`}>{i + 1}</td>
                <td className={td}>
                  <ItemCell
                    product={product} products={products} dataCell={cell("item")}
                    onPick={(p) => onEdit(i, { productId: p?.id ?? "", unitPrice: "" })}
                    onNext={() => focusCell(i, COL.quantity)} onFocusRow={() => onActivate(i)} onArrow={(d) => focusCell(i + d, COL.item)}
                  />
                </td>
                <td className={`${td} text-center`}>{pl?.hsnCode ?? ""}</td>
                <td className={num} data-testid="sheet-cartons">{product && D(pieces).greaterThan(0) ? formatQuantity(D(pieces).div(product.qtyPerCarton).toDecimalPlaces(2)) : ""}</td>
                <td className={`${num} text-muted-foreground`} data-testid="sheet-qty-per-carton">{product?.qtyPerCarton ?? ""}</td>
                <td className={td}>
                  <input data-cell={cell("quantity")} aria-label="Quantity" inputMode="decimal" disabled={!product} className="w-full bg-transparent px-1 py-1.5 text-right outline-none focus:bg-yellow-50 disabled:cursor-not-allowed"
                    value={line?.qty ?? ""} onChange={(e) => onEdit(i, { qty: e.target.value })} onKeyDown={keys(i, COL.quantity)} onFocus={(e) => e.currentTarget.select()} />
                </td>
                <td className={td}>
                  <select data-cell={cell("unit")} aria-label="Unit" disabled={!product} className="w-full bg-transparent px-0.5 py-1.5 outline-none focus:bg-yellow-50 disabled:cursor-not-allowed"
                    value={line?.unit ?? "carton"} onChange={(e) => { rememberUnit(e.target.value as QtyUnit); onEdit(i, { unit: e.target.value as QtyUnit }); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focusCell(i + 1, COL.item); } }}>
                    {QTY_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                  </select>
                </td>
                <td className={`${num} font-medium`} data-testid="sheet-total-qty">{product && D(pieces).greaterThan(0) ? `${formatQuantity(pieces)} ${product.unit}` : ""}</td>
                <td className={td}>
                  <input data-cell={cell("rate")} aria-label="Rate" inputMode="decimal" disabled={!product} placeholder={product ? formatQuantity(rateFor(product, rateTier)) : ""} className="w-full bg-transparent px-1 py-1.5 text-right outline-none placeholder:text-neutral-400 focus:bg-yellow-50 disabled:cursor-not-allowed"
                    value={line?.unitPrice ?? ""} onChange={(e) => onEdit(i, { unitPrice: e.target.value })} onKeyDown={keys(i, COL.rate)} onFocus={(e) => e.currentTarget.select()} />
                </td>
                <td className={td}>
                  <input data-cell={cell("discount")} aria-label="Discount" inputMode="decimal" disabled={!product} className="w-full bg-transparent px-1 py-1.5 text-right outline-none focus:bg-yellow-50 disabled:cursor-not-allowed"
                    value={line?.discountAmount ?? ""} onChange={(e) => onEdit(i, { discountAmount: e.target.value })} onKeyDown={keys(i, COL.discount)} onFocus={(e) => e.currentTarget.select()} />
                </td>
                <td className={`${td} text-center`} data-testid="sheet-gst-rate">{product ? `${formatQuantity(product.gstRate)}%` : ""}</td>
                <td className={num}>{pl && !interState ? formatAmount(pl.cgstAmount) : ""}</td>
                <td className={num}>{pl && !interState ? formatAmount(pl.sgstAmount) : ""}</td>
                <td className={num}>{pl && interState ? formatAmount(pl.igstAmount) : ""}</td>
                <td className={`${num} font-semibold`} data-testid="sheet-line-total">{pl ? formatAmount(pl.lineTotal) : ""}</td>
                <td className={`${td} text-center`}>
                  {line && (line.productId || line.qty) && (
                    <button type="button" aria-label={`Clear row ${i + 1}`} tabIndex={-1} className="text-neutral-400 hover:text-destructive" onClick={() => onClear(i)}>×</button>
                  )}
                </td>
              </tr>
            );
          })}

          <tr className="bg-neutral-50 font-bold">
            <td colSpan={3} className={`${td} px-2 py-1.5 text-right`}>TOTAL</td>
            <td className={num}>{preview ? formatQuantity(totalCartons.toDecimalPlaces(2)) : ""}</td>
            <td colSpan={3} className={td} />
            <td className={num}>{preview ? formatQuantity(totalQty) : ""}</td>
            <td colSpan={3} className={td} />
            <td className={num}>{preview && !interState ? formatAmount(sum((l) => l.cgstAmount)) : ""}</td>
            <td className={num}>{preview && !interState ? formatAmount(sum((l) => l.sgstAmount)) : ""}</td>
            <td className={num}>{preview && interState ? formatAmount(sum((l) => l.igstAmount)) : ""}</td>
            <td className={num}>{preview ? formatAmount(sum((l) => l.lineTotal)) : ""}</td>
            <td className={td} />
          </tr>

          {CHARGE_FIELDS.map((c) => {
            const pc = preview?.charges.find((x) => x.kind === c.kind);
            return (
              <tr key={c.kind}>
                <td colSpan={3} className={`${td} px-2 py-1 font-bold uppercase`}>{c.label}</td>
                <td colSpan={2} className={`${td} px-2 text-right font-bold`}>AMOUNT</td>
                <td colSpan={6} className={td}>
                  <input id={`charge-${c.kind}`} aria-label={c.label} inputMode="decimal" placeholder="0.00" className="w-full bg-transparent px-1 py-1.5 text-right outline-none focus:bg-yellow-50"
                    value={charges[c.kind]} onChange={(e) => onCharges({ ...charges, [c.kind]: e.target.value })} onFocus={(e) => e.currentTarget.select()} />
                </td>
                <td className={num}>{pc && !interState ? formatAmount(pc.cgstAmount) : ""}</td>
                <td className={num}>{pc && !interState ? formatAmount(pc.sgstAmount) : ""}</td>
                <td className={num}>{pc && interState ? formatAmount(pc.igstAmount) : ""}</td>
                <td className={`${num} font-semibold`}>{pc ? formatAmount(pc.lineTotal) : ""}</td>
                <td className={td} />
              </tr>
            );
          })}

          {preview && !D(preview.roundOff).isZero() && (
            <tr>
              <td colSpan={14} className={`${td} px-2 py-1 text-right font-bold`}>ROUND OFF</td>
              <td className={num}>{formatAmount(preview.roundOff)}</td>
              <td className={td} />
            </tr>
          )}
          <tr className="bg-neutral-50">
            <td colSpan={3} className={`${td} px-2 py-2 font-bold`}>INVOICE VALUE (IN WORDS)</td>
            <td colSpan={8} className={`${td} px-2`}>{preview ? amountInWords(preview.grandTotal) : ""}</td>
            <td colSpan={3} className={`${td} px-2 text-right font-bold`}>GRAND TOTAL</td>
            <td className={`${num} text-base font-bold`} data-testid="sheet-grand-total">{preview ? formatAmount(preview.grandTotal) : ""}</td>
            <td className={td} />
          </tr>
        </tbody>
      </table>
      </div>
    </div>
    </div>
  );
}
