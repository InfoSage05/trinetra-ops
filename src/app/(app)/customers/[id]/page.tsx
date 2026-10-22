import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getSession } from "@/lib/session";
import { NotFoundError } from "@/lib/errors";
import { stateName } from "@/lib/gst";
import { formatINR } from "@/lib/money";
import { formatDateIN } from "@/lib/time";
import { getCustomerDetail } from "@/domain/reports";

const STATUS_LABEL = { PAID: "Paid", PARTIAL: "Part paid", UNPAID: "Unpaid (on credit)" } as const;

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { customer, bills, billedTotal, totalDue } = await getCustomerDetail(await getSession(), id)
    .catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });

  return (
    <div className="space-y-4">
      <Link href="/customers" className="text-sm underline">← All customers</Link>
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h1>{customer.name}</h1>
          <p className="text-sm text-muted-foreground">{[customer.phone, customer.gstin ?? "Unregistered", stateName(customer.stateCode)].filter(Boolean).join(" · ")}</p>
          <p className="text-sm text-muted-foreground">{customer.billingAddress}</p>
        </div>
        <Link href={`/billing/new?customer=${customer.id}`} className={buttonVariants({ size: "lg" })}>New bill for this customer</Link>
        <Link href={`/orders/new?customer=${customer.id}`} className={buttonVariants({ variant: "outline", size: "lg" })}>New order</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]"><p className="text-xs font-medium tracking-wide uppercase text-muted-foreground">Billed so far</p><p className="mt-0.5 text-2xl font-bold tabular-nums">{formatINR(billedTotal)}</p></div>
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]"><p className="text-xs font-medium tracking-wide uppercase text-muted-foreground">Still to pay</p><p className={`mt-0.5 text-2xl font-bold tabular-nums ${totalDue.greaterThan(0) ? "text-destructive" : ""}`} data-testid="customer-due">{formatINR(totalDue)}</p></div>
      </div>

      <ul className="divide-y divide-border/80 rounded-xl bg-card ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]">
        {bills.map((b) => (
          <li key={b.id}>
            <Link href={`/bills/${b.id}`} className="flex flex-wrap items-center gap-2 p-4 transition-colors hover:bg-amber-500/[0.05]">
              <div className="mr-auto"><p className="font-medium">{b.invoiceNumber}</p><p className="text-sm text-muted-foreground">{formatDateIN(b.billDate)}</p></div>
              <div className="text-right"><p className="font-semibold tabular-nums">{formatINR(b.grandTotal)}</p>
                <Badge variant={b.payment.status === "PAID" ? "success" : "destructive"}>{STATUS_LABEL[b.payment.status]}{b.payment.status !== "PAID" ? ` · due ${formatINR(b.payment.amountDue)}` : ""}</Badge></div>
            </Link>
          </li>
        ))}
        {bills.length === 0 && <li className="p-8 text-center text-muted-foreground">No bills yet.</li>}
      </ul>
    </div>
  );
}
