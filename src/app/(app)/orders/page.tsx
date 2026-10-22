import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getSession } from "@/lib/session";
import { describeStock } from "@/lib/cartons";
import { formatDateIN } from "@/lib/time";
import { getPendingRequirements, listOrders } from "@/domain/orders";
import { OrderStatusBadge } from "@/components/order-status-badge";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const session = await getSession();
  const { show } = await searchParams;
  const all = show === "ALL";
  const [orders, needs] = await Promise.all([listOrders(session, { show: all ? "ALL" : "OPEN" }), getPendingRequirements(session)]);
  const toMake = needs.filter((n) => n.toMake.greaterThan(0));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto">Orders</h1>
        <Link href={all ? "/orders" : "/orders?show=ALL"} className="text-sm underline">{all ? "Show pending only" : "Show all orders"}</Link>
        <Link href="/orders/new" className={buttonVariants({ size: "lg" })}>+ New order</Link>
      </div>

      {toMake.length > 0 && (
        <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]" data-testid="to-make">
          <h2 className="mb-2 font-semibold">Still to make for pending orders</h2>
          <ul className="space-y-1 text-sm">
            {toMake.map((n) => (
              <li key={n.productId} className="flex justify-between gap-2">
                <Link href={`/inventory/${n.productId}`} className="underline">{n.productName}</Link>
                <span>make {describeStock(n.toMake.toString(), n.qtyPerCarton)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="divide-y divide-border/80 rounded-xl bg-card ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]">
        {orders.map((o) => (
          <li key={o.id}>
            <Link href={`/orders/${o.id}`} className="flex flex-wrap items-center gap-2 p-3 hover:bg-muted/50">
              <div className="mr-auto">
                <p className="font-medium">{o.customer.name}</p>
                <p className="text-sm text-muted-foreground">Needed by {formatDateIN(o.dueDate)} · {o.lines.length} item(s)</p>
              </div>
              {o.dueState === "OVERDUE" && <Badge variant="destructive">Overdue</Badge>}
              {o.dueState === "DUE_SOON" && <Badge variant="warning">Due soon</Badge>}
              <OrderStatusBadge status={o.status} />
            </Link>
          </li>
        ))}
        {orders.length === 0 && <li className="p-6 text-center text-muted-foreground">No orders.</li>}
      </ul>
    </div>
  );
}
