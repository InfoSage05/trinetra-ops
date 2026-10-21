"use client";
import { useRef, useState } from "react";
import type { BillableProduct } from "@/components/product-picker";
import { CHARGE_FIELDS, linePieces, type Charges, type Line } from "@/components/bill-lines";
import type { Plain } from "@/lib/action-result";
import type { BillPreview } from "@/domain/billing";
import { D, amountInWords, formatAmount, formatQuantity } from "@/lib/money";

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
};

const MIN_ROWS = 12;
const COL = { item: 0, cartons: 1, pieces: 2, rate: 3, discount: 4 } as const;
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
      {matches.length > 0 && box && (
        <ul role="listbox" className="fixed z-50 max-h-64 overflow-auto rounded-md border bg-background text-sm shadow-lg" style={{ left: box.left, top: box.top, width: box.width }}>
          {matches.map((p, i) => (
            <li
              key={p.id} role="option" aria-selected={i === highlight}
              className={`flex cursor-pointer justify-between gap-2 px-2 py-1.5 ${i === highlight ? "bg-yellow-100" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(p); onNext(); }}
            >
              <span>{p.name}{p.sku && <span className="text-muted-foreground"> ({p.sku})</span>}</span>
              <span className="whitespace-nowrap text-muted-foreground">{formatQuantity(p.unitPrice)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function BillSheet({ products, lines, filledLines, preview, charges, onCharges, onEdit, onClear, onActivate }: Props) {
  const tableRef = useRef<HTMLTableElement>(null);
  const rowCount = Math.max(MIN_ROWS, lines.length + 1);

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

  return (
    <div className="overflow-x-auto rounded-md border bg-background" data-testid="bill-sheet">
      <table ref={tableRef} className="w-full min-w-[980px] border-collapse text-sm">
        <colgroup>
          {[4, 24, 7, 7, 5, 7, 7, 5, 8, 7, 8, 8, 8, 9, 3].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
        </colgroup>
        <thead>
          <tr>
            {["Sl no", "Description of goods", "HSN", "No of cartons", "+ Pcs", "Qty per carton", "Total qty", "Unit", "Rate", "Discount ₹", "CGST", "SGST", "IGST", "Total amount", ""].map((h, i) => <th key={i} className={th}>{h}</th>)}
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
                    onNext={() => focusCell(i, COL.cartons)} onFocusRow={() => onActivate(i)} onArrow={(d) => focusCell(i + d, COL.item)}
                  />
                </td>
                <td className={`${td} text-center`}>{pl?.hsnCode ?? ""}</td>
                <td className={td}>
                  <input data-cell={cell("cartons")} aria-label="Cartons" inputMode="decimal" disabled={!product} className="w-full bg-transparent px-1 py-1.5 text-right outline-none focus:bg-yellow-50 disabled:cursor-not-allowed"
                    value={line?.cartons ?? ""} onChange={(e) => onEdit(i, { cartons: e.target.value })} onKeyDown={keys(i, COL.cartons)} onFocus={(e) => e.currentTarget.select()} />
                </td>
                <td className={td}>
                  <input data-cell={cell("pieces")} aria-label="Extra pieces" inputMode="decimal" disabled={!product} className="w-full bg-transparent px-1 py-1.5 text-right outline-none focus:bg-yellow-50 disabled:cursor-not-allowed"
                    value={line?.loosePieces ?? ""} onChange={(e) => onEdit(i, { loosePieces: e.target.value })} onKeyDown={keys(i, COL.pieces)} onFocus={(e) => e.currentTarget.select()} />
                </td>
                <td className={`${num} text-muted-foreground`} data-testid="sheet-qty-per-carton">{product?.qtyPerCarton ?? ""}</td>
                <td className={`${num} font-medium`} data-testid="sheet-total-qty">{product && D(pieces).greaterThan(0) ? formatQuantity(pieces) : ""}</td>
                <td className={`${td} text-center`}>{product?.unit ?? ""}</td>
                <td className={td}>
                  <input data-cell={cell("rate")} aria-label="Rate" inputMode="decimal" disabled={!product} placeholder={product ? formatQuantity(product.unitPrice) : ""} className="w-full bg-transparent px-1 py-1.5 text-right outline-none placeholder:text-neutral-400 focus:bg-yellow-50 disabled:cursor-not-allowed"
                    value={line?.unitPrice ?? ""} onChange={(e) => onEdit(i, { unitPrice: e.target.value })} onKeyDown={keys(i, COL.rate)} onFocus={(e) => e.currentTarget.select()} />
                </td>
                <td className={td}>
                  <input data-cell={cell("discount")} aria-label="Discount" inputMode="decimal" disabled={!product} className="w-full bg-transparent px-1 py-1.5 text-right outline-none focus:bg-yellow-50 disabled:cursor-not-allowed"
                    value={line?.discountAmount ?? ""} onChange={(e) => onEdit(i, { discountAmount: e.target.value })} onKeyDown={keys(i, COL.discount)} onFocus={(e) => e.currentTarget.select()} />
                </td>
                <td className={num}>{pl && !interState ? formatAmount(pl.cgstAmount) : ""}</td>
                <td className={num}>{pl && !interState ? formatAmount(pl.sgstAmount) : ""}</td>
                <td className={num}>{pl && interState ? formatAmount(pl.igstAmount) : ""}</td>
                <td className={`${num} font-semibold`} data-testid="sheet-line-total">{pl ? formatAmount(pl.lineTotal) : ""}</td>
                <td className={`${td} text-center`}>
                  {line && (line.productId || line.cartons) && (
                    <button type="button" aria-label={`Clear row ${i + 1}`} tabIndex={-1} className="text-neutral-400 hover:text-destructive" onClick={() => onClear(i)}>×</button>
                  )}
                </td>
              </tr>
            );
          })}

          <tr className="bg-neutral-50 font-bold">
            <td colSpan={3} className={`${td} px-2 py-1.5 text-right`}>TOTAL</td>
            <td className={num}>{preview ? formatQuantity(totalCartons.toDecimalPlaces(2)) : ""}</td>
            <td className={td} />
            <td className={td} />
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
                <td colSpan={5} className={td}>
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
              <td colSpan={13} className={`${td} px-2 py-1 text-right font-bold`}>ROUND OFF</td>
              <td className={num}>{formatAmount(preview.roundOff)}</td>
              <td className={td} />
            </tr>
          )}
          <tr className="bg-neutral-50">
            <td colSpan={3} className={`${td} px-2 py-2 font-bold`}>INVOICE VALUE (IN WORDS)</td>
            <td colSpan={7} className={`${td} px-2`}>{preview ? amountInWords(preview.grandTotal) : ""}</td>
            <td colSpan={3} className={`${td} px-2 text-right font-bold`}>GRAND TOTAL</td>
            <td className={`${num} text-base font-bold`} data-testid="sheet-grand-total">{preview ? formatAmount(preview.grandTotal) : ""}</td>
            <td className={td} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
