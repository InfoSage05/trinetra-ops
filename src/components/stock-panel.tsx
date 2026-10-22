"use client";
import { Badge } from "@/components/ui/badge";
import { describeStock } from "@/lib/cartons";
import { D, formatQuantity } from "@/lib/money";

export type PanelProduct = { id: string; name: string; sku: string | null; unit: string; qtyPerCarton: number; reorderLevel: string; stock: string };

type Props = {
  product: PanelProduct | undefined;
  /** Live stock from the server for this bill (reflects other lines of the same product). */
  availableNow: string | undefined;
  /** Pieces this bill takes of the item (all lines of that item added together). */
  takingNow: string;
  others: PanelProduct[];
};

function figures(product: PanelProduct | undefined, availableNow: string | undefined, takingNow: string) {
  const available = D(availableNow ?? product?.stock ?? 0);
  const taking = D(takingNow || 0);
  const left = available.minus(taking);
  const reorder = D(product?.reorderLevel ?? 0);
  const short = left.isNegative();
  const low = !short && reorder.greaterThan(0) && left.lessThanOrEqualTo(reorder);
  return { available, taking, left, reorder, short, low };
}

/** One-line version for phones, where a full card would cover the form. */
export function StockBar({ product, availableNow, takingNow }: Omit<Props, "others">) {
  if (!product) return null;
  const { available, taking, left, short, low } = figures(product, availableNow, takingNow);
  return (
    <div className={`rounded-lg bg-card px-3 py-2 text-sm shadow-md ring-1 ring-foreground/10 ${short ? "border-destructive" : ""}`} data-testid="stock-bar">
      <p className="truncate font-medium">{product.name}</p>
      <p>
        In stock: <b>{describeStock(available.toString(), product.qtyPerCarton)}</b>
        {taking.greaterThan(0) && (
          <> · After this bill: <b className={short ? "text-destructive" : low ? "text-warning-foreground" : ""}>{short ? `Short by ${formatQuantity(left.abs())} pcs` : describeStock(left.toString(), product.qtyPerCarton)}</b></>
        )}
      </p>
    </div>
  );
}

/** The "stock check" shown beside the billing form: how much of the item being billed is really on the shelf. */
export function StockPanel({ product, availableNow, takingNow, others }: Props) {
  const { available, taking, left, reorder, short, low } = figures(product, availableNow, takingNow);

  return (
    <div className="rounded-xl bg-card p-4 shadow-md ring-1 ring-foreground/10" data-testid="stock-panel">
      <h2 className="text-base font-semibold">Stock check</h2>
      {product ? (
        <div className="mt-2 space-y-2">
          <p className="font-medium">{product.name} {product.sku && <span className="text-sm text-muted-foreground">({product.sku})</span>}</p>
          <div>
            <p className="text-xs uppercase text-muted-foreground">In stock now</p>
            <p className="text-lg font-semibold" data-testid="stock-now">{describeStock(available.toString(), product.qtyPerCarton)}</p>
            <p className="text-xs text-muted-foreground">1 carton = {product.qtyPerCarton} {product.unit}</p>
          </div>
          {taking.greaterThan(0) && (
            <>
              <div>
                <p className="text-xs uppercase text-muted-foreground">This bill takes</p>
                <p className="font-medium">{describeStock(taking.toString(), product.qtyPerCarton)}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Left after this bill</p>
                <p className={`font-semibold ${short ? "text-destructive" : ""}`} data-testid="stock-left">
                  {short ? `Short by ${formatQuantity(left.abs())} pcs` : describeStock(left.toString(), product.qtyPerCarton)}
                </p>
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-1">
            {short && <Badge variant="destructive">Not enough stock</Badge>}
            {low && <Badge variant="warning">Running low (warn at {formatQuantity(reorder)})</Badge>}
            {!short && !low && taking.greaterThan(0) && <Badge variant="secondary">Enough stock</Badge>}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Choose an item to see how much is in stock.</p>
      )}
      {others.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <p className="mb-1 text-xs uppercase text-muted-foreground">All items</p>
          <ul className="max-h-56 space-y-1 overflow-auto text-sm">
            {others.map((o) => (
              <li key={o.id} className="flex justify-between gap-2">
                <span className="truncate">{o.name}</span>
                <span className={`whitespace-nowrap ${D(o.stock).isNegative() ? "text-destructive" : "text-muted-foreground"}`}>{describeStock(o.stock, o.qtyPerCarton)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
