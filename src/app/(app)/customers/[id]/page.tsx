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
          <h1 className="text-xl font-semibold">{customer.name}</h1>
          <p className="text-sm text-muted-foreground">{[customer.phone, customer.gstin ?? "Unregistered", stateName(customer.stateCode)].filter(Boolean).join(" · ")}</p>
          <p className="text-sm text-muted-foreground">{customer.billingAddress}</p>
        </div>
        <Link href={`/billing/new?customer=${customer.id}`} className={buttonVariants({ size: "lg" })}>New bill for this customer</Link>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border bg-background p-4"><p className="text-xs uppercase text-muted-foreground">Billed so far</p><p className="text-xl font-semibold">{formatINR(billedTotal)}</p></div>
        <div className="rounded-md border bg-background p-4"><p className="text-xs uppercase text-muted-foreground">Still to pay</p><p className={`text-xl font-semibold ${totalDue.greaterThan(0) ? "text-destructive" : ""}`} data-testid="customer-due">{formatINR(totalDue)}</p></div>
      </div>

      <ul className="divide-y rounded-md border bg-background">
        {bills.map((b) => (
          <li key={b.id}>
            <Link href={`/bills/${b.id}`} className="flex flex-wrap items-center gap-2 p-3 hover:bg-muted/50">
              <div className="mr-auto"><p className="font-medium">{b.invoiceNumber}</p><p className="text-sm text-muted-foreground">{formatDateIN(b.billDate)}</p></div>
              <div className="text-right"><p className="font-medium">{formatINR(b.grandTotal)}</p>
                <Badge variant={b.payment.status === "PAID" ? "secondary" : "destructive"}>{STATUS_LABEL[b.payment.status]}{b.payment.status !== "PAID" ? ` · due ${formatINR(b.payment.amountDue)}` : ""}</Badge></div>
            </Link>
          </li>
        ))}
        {bills.length === 0 && <li className="p-6 text-center text-muted-foreground">No bills yet.</li>}
      </ul>
    </div>
  );
}
