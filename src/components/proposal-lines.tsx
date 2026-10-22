"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Plain } from "@/lib/action-result";
import type { ProposalLine } from "@/domain/ai-stock";
import { D, formatQuantity } from "@/lib/money";

export type CatalogueItem = { id: string; name: string; qtyPerCarton: number };
export type EditableLine = { key: number; rawName: string; status: ProposalLine["status"]; productId: string; quantity: string; unit: "carton" | "piece" };

let nextKey = 1;

/** Turns the server's proposal into rows a person can fix. Only clear matches are pre-selected. */
export function toEditable(lines: Plain<ProposalLine>[]): EditableLine[] {
  return lines.map((l) => ({
    key: nextKey++, rawName: l.rawName, status: l.status,
    productId: l.status === "MATCHED" ? l.productId ?? "" : "",
    quantity: String(l.quantity), unit: l.unit,
  }));
}

export function blankLine(): EditableLine {
  return { key: nextKey++, rawName: "", status: "UNMATCHED", productId: "", quantity: "", unit: "carton" };
}

export function piecesOf(line: EditableLine, catalogue: CatalogueItem[]): string | null {
  const product = catalogue.find((p) => p.id === line.productId);
  if (!product) return null;
  try {
    const qty = D(line.quantity || 0);
    return (line.unit === "carton" ? qty.times(product.qtyPerCarton) : qty).toString();
  } catch {
    return null;
  }
}

/** Every row needs an item and a quantity above zero before it can be saved. */
export function linesReady(lines: EditableLine[], catalogue: CatalogueItem[], allowZero = false): boolean {
  return lines.length > 0 && lines.every((l) => {
    const pieces = piecesOf(l, catalogue);
    return pieces !== null && (allowZero ? !D(pieces).isNegative() && l.quantity.trim() !== "" : D(pieces).greaterThan(0));
  });
}

export function LinesEditor({ lines, catalogue, onChange }: { lines: EditableLine[]; catalogue: CatalogueItem[]; onChange: (lines: EditableLine[]) => void }) {
  const patch = (key: number, change: Partial<EditableLine>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...change } : l)));
  return (
    <ul className="divide-y divide-border/80 rounded-xl bg-card ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]" data-testid="proposal-lines">
      {lines.map((line) => {
        const pieces = piecesOf(line, catalogue);
        const unsure = line.rawName && line.status !== "MATCHED" && !line.productId;
        return (
          <li key={line.key} className="space-y-2 p-3">
            {line.rawName && <p className="text-sm text-muted-foreground">Heard: “{line.rawName}”{unsure ? " — choose the item" : ""}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Item" value={line.productId} onChange={(e) => patch(line.key, { productId: e.target.value })}
                className={`h-12 min-w-0 flex-1 rounded-lg border border-input bg-card px-2.5 outline-none focus-visible:border-ring ${unsure ? "border-destructive" : ""}`}
              >
                <option value="">Choose item…</option>
                {catalogue.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <Input aria-label="Quantity" className="h-12 w-24" inputMode="decimal" value={line.quantity} onChange={(e) => patch(line.key, { quantity: e.target.value })} />
              <select aria-label="Unit" value={line.unit} onChange={(e) => patch(line.key, { unit: e.target.value as "carton" | "piece" })} className="h-12 rounded-lg border border-input bg-card px-2.5 outline-none focus-visible:border-ring">
                <option value="carton">cartons</option>
                <option value="piece">pieces</option>
              </select>
              <Button variant="ghost" size="sm" onClick={() => onChange(lines.filter((l) => l.key !== line.key))}>Remove</Button>
            </div>
            {pieces !== null && line.unit === "carton" && <p className="text-sm">= <b>{formatQuantity(pieces)}</b> pieces</p>}
          </li>
        );
      })}
      {lines.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">No items yet.</li>}
    </ul>
  );
}
