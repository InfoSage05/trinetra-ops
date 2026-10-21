import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getSession } from "@/lib/session";
import { describeStock } from "@/lib/cartons";
import { NotFoundError } from "@/lib/errors";
import { formatINR, formatQuantity } from "@/lib/money";
import { formatDateIN } from "@/lib/time";
import { getProductDetail } from "@/domain/reports";

const MOVEMENT_LABEL = { OPENING: "Opening stock", PRODUCED: "Made", BILLED: "Sold on a bill", RETURN: "Returned", ADJUSTMENT: "Correction" } as const;

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const item = await getProductDetail(session, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const isOwner = session?.role === "OWNER";

  return (
    <div className="space-y-4">
      <Link href="/inventory" className="text-sm underline">← All stock</Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">{item.name}</h1>
          <p className="text-sm text-muted-foreground">{item.sku} · {item.qtyPerCarton} {item.unit} per carton{item.unitPrice ? ` · ${formatINR(item.unitPrice.toString())} each` : ""}</p>
        </div>
        {isOwner && <Link href={`/billing/new?product=${item.id}`} className={buttonVariants({ size: "lg" })}>Bill this item</Link>}
      </div>

      <div className="rounded-md border bg-background p-4">
        <p className="text-xs uppercase text-muted-foreground">In stock now</p>
        <p className="text-2xl font-semibold" data-testid="item-stock">{describeStock(item.stock.toString(), item.qtyPerCarton)}</p>
        <div className="mt-2 flex gap-2">
          {item.status === "NEGATIVE" && <Badge variant="destructive">Oversold</Badge>}
          {item.status === "LOW" && <Badge className="bg-amber-500">Running low (warn at {formatQuantity(item.reorderLevel)})</Badge>}
        </div>
      </div>

      <section>
        <h2 className="mb-2 font-semibold">Stock movements</h2>
        <ul className="divide-y rounded-md border bg-background">
          {item.movements.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
              <div className="mr-auto">
                <p className="font-medium">{MOVEMENT_LABEL[m.type]}{m.actorType === "AGENT" ? " (by assistant)" : ""}</p>
                <p className="text-muted-foreground">{formatDateIN(m.createdAt)}{m.reason ? ` · ${m.reason}` : ""}</p>
              </div>
              <span className={`font-semibold ${m.quantityDelta.isNegative() ? "text-destructive" : ""}`}>{m.quantityDelta.isNegative() ? "" : "+"}{formatQuantity(m.quantityDelta.toString())} pcs</span>
            </li>
          ))}
          {item.movements.length === 0 && <li className="p-6 text-center text-muted-foreground">No movements yet.</li>}
        </ul>
      </section>

      {isOwner && item.recentSales.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Recent sales</h2>
          <ul className="divide-y rounded-md border bg-background">
            {item.recentSales.map((s) => (
              <li key={s.billId}>
                <Link href={`/bills/${s.billId}`} className="flex flex-wrap gap-2 p-3 text-sm hover:bg-muted/50">
                  <span className="mr-auto font-medium">{s.invoiceNumber} · {s.customerName}</span>
                  <span>{formatQuantity(s.quantity.toString())} pcs · {formatDateIN(s.billDate)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
