"use client";
import { Badge } from "@/components/ui/badge";
import { describeStock } from "@/lib/cartons";
import { D, formatQuantity } from "@/lib/money";

export type PanelProduct = { id: string; name: string; sku: string; unit: string; qtyPerCarton: number; reorderLevel: string; stock: string };

type Props = {
  product: PanelProduct | undefined;
  /** Live stock from the server for this bill (reflects other lines of the same product). */
  availableNow: string | undefined;
  /** Pieces this bill takes of the item (all lines of that item added together). */
  takingNow: string;
  others: PanelProduct[];
  onClose?: () => void;
};

/** The "stock check" shown beside the billing form: how much of the item being billed is really on the shelf. */
export function StockPanel({ product, availableNow, takingNow, others, onClose }: Props) {
  const available = D(availableNow ?? product?.stock ?? 0);
  const taking = D(takingNow || 0);
  const left = available.minus(taking);
  const reorder = D(product?.reorderLevel ?? 0);
  const short = left.isNegative();
  const low = !short && reorder.greaterThan(0) && left.lessThanOrEqualTo(reorder);

  return (
    <div className="rounded-lg border bg-background p-4 shadow-md" data-testid="stock-panel">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold">Stock check</h2>
        {onClose && <button type="button" onClick={onClose} className="text-sm text-muted-foreground underline lg:hidden">Hide</button>}
      </div>
      {product ? (
        <div className="mt-2 space-y-2">
          <p className="font-medium">{product.name} <span className="text-sm text-muted-foreground">({product.sku})</span></p>
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
            {low && <Badge className="bg-amber-500">Running low (warn at {formatQuantity(reorder)})</Badge>}
            {!short && !low && taking.greaterThan(0) && <Badge variant="secondary">Enough stock</Badge>}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Choose an item to see how much is in stock.</p>
      )}
      {others.length > 0 && (
        <div className="mt-4 hidden border-t pt-3 lg:block">
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
