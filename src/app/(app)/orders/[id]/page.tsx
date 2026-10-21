import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { describeStock } from "@/lib/cartons";
import { NotFoundError } from "@/lib/errors";
import { orderReminderText, whatsappShareUrl } from "@/lib/share";
import { formatDateIN } from "@/lib/time";
import { getOrder } from "@/domain/orders";
import { getBusinessProfile } from "@/domain/settings";
import { OrderActions } from "@/components/order-actions";
import { OrderStatusBadge } from "@/components/order-status-badge";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const order = await getOrder(session, id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const profile = await getBusinessProfile(prisma);
  const reminder = whatsappShareUrl(order.customer.phone, orderReminderText({
    supplierName: profile?.legalName ?? "Trinetra Candles", customerName: order.customer.name, dueDate: formatDateIN(order.dueDate),
    overdue: order.dueState === "OVERDUE",
    lines: order.lines.filter((l) => l.outstanding.greaterThan(0)).map((l) => ({ name: l.productName, cartons: describeStock(l.outstanding.toString(), l.qtyPerCarton) })),
  }));

  return (
    <div className="space-y-4">
      <Link href="/orders" className="text-sm underline">← All orders</Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">{order.customer.name}</h1>
          <p className="text-sm text-muted-foreground">Needed by {formatDateIN(order.dueDate)}{order.source !== "MANUAL" ? ` · entered by ${order.source === "VOICE" ? "voice" : order.source === "IMAGE" ? "photo" : "typing"} with the assistant` : ""}</p>
          {order.notes && <p className="text-sm">{order.notes}</p>}
        </div>
        {order.dueState === "OVERDUE" && <Badge variant="destructive">Overdue</Badge>}
        {order.dueState === "DUE_SOON" && <Badge className="bg-amber-500">Due soon</Badge>}
        <OrderStatusBadge status={order.status} />
      </div>

      {order.open && (
        <div className="flex flex-wrap gap-2">
          <Link href={`/billing/new?order=${order.id}`} className={buttonVariants({ size: "lg" })}>Create bill from this order</Link>
          <a href={reminder} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "lg" })}>WhatsApp reminder</a>
          <OrderActions orderId={order.id} />
        </div>
      )}

      <ul className="divide-y rounded-md border bg-background">
        {order.lines.map((l) => (
          <li key={l.productId} className="space-y-1 p-3 text-sm">
            <p className="font-medium"><Link href={`/inventory/${l.productId}`} className="underline-offset-2 hover:underline">{l.productName}</Link></p>
            <p>Ordered: {describeStock(l.ordered.toString(), l.qtyPerCarton)}</p>
            <p>Delivered: {describeStock(l.delivered.toString(), l.qtyPerCarton)}</p>
            <p className={l.outstanding.greaterThan(l.stock) && order.open ? "text-destructive" : ""}>
              Still to deliver: {describeStock(l.outstanding.toString(), l.qtyPerCarton)}
              {order.open && l.outstanding.greaterThan(0) && <> · in stock: {describeStock(l.stock.toString(), l.qtyPerCarton)}</>}
            </p>
          </li>
        ))}
      </ul>

      {order.bills.length > 0 && (
        <section>
          <h2 className="mb-1 font-semibold">Bills for this order</h2>
          <p className="text-sm">{order.bills.map((b, i) => <span key={b.id}>{i > 0 && ", "}<Link className="underline" href={`/bills/${b.id}`}>{b.invoiceNumber}</Link></span>)}</p>
        </section>
      )}
    </div>
  );
}
