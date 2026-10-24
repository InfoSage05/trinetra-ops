"use client";
import type { BillableProduct } from "@/components/product-picker";
import type { Line, RateChoice } from "@/components/bill-lines";
import { Input } from "@/components/ui/input";
import { RATE_TIERS, rateFor, type RateTier } from "@/lib/rates";
import { rateInUnit } from "@/components/bill-amounts";
import { piecesPerUnit } from "@/components/bill-lines";
import { formatQuantity } from "@/lib/money";

type Props = {
  product: BillableProduct;
  line: Pick<Line, "rateChoice" | "unitPrice" | "unit">;
  /** The rate type chosen for the whole bill; used when this line says "Bill rate". */
  billTier: RateTier;
  onChange: (patch: Partial<Pick<Line, "rateChoice" | "unitPrice">>) => void;
  /** Sheet cells are narrow, so the drop-down shows only a short label there. */
  compact?: boolean;
  cellName?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
};

/** The rate used on one bill line. */
export function effectiveRate(product: BillableProduct, line: Pick<Line, "rateChoice" | "unitPrice" | "unit">, billTier: RateTier) {
  if (line.unitPrice.trim() !== "") return line.unitPrice.trim();
  return formatQuantity(rateInUnit(product, line, billTier));
}

/**
 * A drop-down of the item's three rates (A, B, C) plus "own rate", and a box that always shows the rate being used.
 * Typing a number in the box is an own rate; picking A, B or C in the list uses that rate for this line only.
 */
export function RateChoicePicker({ product, line, billTier, onChange, compact, cellName, onKeyDown }: Props) {
  const own = line.unitPrice.trim() !== "";
  const value: RateChoice | "custom" = own ? "custom" : line.rateChoice;
  const factor = piecesPerUnit(line.unit); // the rates are shown per patty, per dozen or per piece, to match the unit
  const amount = (tier: RateTier) => `₹${formatQuantity(rateFor(product, tier).times(factor))}`;
  const label = (tier: RateTier) => (compact ? tier : `Rate ${tier} ${amount(tier)}${tier !== "B" && rateFor(product, tier).equals(rateFor(product, "B")) ? " (same as B)" : ""}`);

  return (
    <div className={compact ? "flex items-center" : "flex gap-2"}>
      <select
        aria-label="Rate choice" value={value}
        className={compact ? "w-12 bg-transparent px-0.5 py-1.5 text-xs outline-none focus:bg-yellow-50" : "h-12 min-w-0 flex-1 rounded-lg border border-input bg-card px-2"}
        onChange={(e) => {
          const next = e.target.value as RateChoice | "custom";
          if (next === "custom") onChange({ unitPrice: rateInUnit(product, line, billTier).toDecimalPlaces(4).toString() });
          else onChange({ rateChoice: next, unitPrice: "" });
        }}
      >
        <option value="bill">{compact ? "Bill" : `Bill rate (${billTier}) ${amount(billTier)}`}</option>
        {RATE_TIERS.map((t) => <option key={t} value={t}>{label(t)}</option>)}
        <option value="custom">{compact ? "Own" : "Own rate…"}</option>
      </select>
      {compact ? (
        <input
          data-cell={cellName} aria-label="Rate" inputMode="decimal" placeholder={effectiveRate(product, line, billTier)}
          className="w-full min-w-0 bg-transparent px-1 py-1.5 text-right outline-none placeholder:text-neutral-400 focus:bg-yellow-50"
          value={line.unitPrice} onChange={(e) => onChange({ unitPrice: e.target.value })} onKeyDown={onKeyDown} onFocus={(e) => e.currentTarget.select()}
        />
      ) : (
        <Input aria-label="Rate" className="h-12 w-28" inputMode="decimal" placeholder={effectiveRate(product, line, billTier)} value={line.unitPrice} onChange={(e) => onChange({ unitPrice: e.target.value })} />
      )}
    </div>
  );
}
