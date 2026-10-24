import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getSession } from "@/lib/session";
import { formatINR } from "@/lib/money";
import { DeleteBillButton } from "@/components/delete-bill-button";
import { formatDateIN } from "@/lib/time";
import { listBillsPage } from "@/domain/reports";

const STATUS_LABEL = { PAID: "Paid", PARTIAL: "Part paid", UNPAID: "Unpaid (on credit)" } as const;

export default async function BillsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const { q, status, page: pageParam } = await searchParams;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(pageParam ?? "1", 10) || 1));
  const validStatus = status === "PAID" || status === "PARTIAL" || status === "UNPAID" || status === "DUE" ? status : undefined;
  const { bills, hasMore } = await listBillsPage(await getSession(), { search: q || undefined, status: validStatus, page });
  const pageLink = (p: number) => `/bills?${new URLSearchParams({ ...(q ? { q } : {}), ...(validStatus ? { status: validStatus } : {}), page: String(p) })}`;
  return (
    <div className="space-y-4">
      <div className="flex items-center"><h1 className="mr-auto">Bills</h1><Link href="/billing/new" className={buttonVariants({ size: "default" })}>New bill</Link></div>
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Invoice no. or customer" className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 text-sm shadow-[inset_0_1px_1px_rgb(64_38_16/0.03)] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30" />
        <select name="status" defaultValue={validStatus ?? ""} className="h-10 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30">
          <option value="">All</option><option value="DUE">Money due (unpaid + part paid)</option><option value="UNPAID">Unpaid</option><option value="PARTIAL">Part paid</option><option value="PAID">Paid</option>
        </select>
        <button className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Search</button>
      </form>
      <ul className="divide-y divide-border/80 rounded-xl bg-card ring-1 ring-foreground/10">
        {bills.map((b) => (
          <li key={b.id} className="flex items-center">
            <Link href={`/bills/${b.id}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 p-4 transition-colors hover:bg-amber-500/[0.06]">
              <div className="mr-auto min-w-0"><p className="font-medium">{b.invoiceNumber} · {b.customerName}</p><p className="text-sm text-muted-foreground">{formatDateIN(b.billDate)}</p></div>
              <div className="ml-auto text-right"><p className="font-semibold tabular-nums">{formatINR(b.grandTotal)}</p>
                <Badge variant={b.payment.status === "PAID" ? "success" : "destructive"}>{STATUS_LABEL[b.payment.status]}{b.payment.status !== "PAID" ? ` · due ${formatINR(b.payment.amountDue)}` : ""}</Badge></div>
            </Link>
            <div className="pr-3"><DeleteBillButton billId={b.id} invoiceNumber={b.invoiceNumber} customerName={b.customerName} /></div>
          </li>
        ))}
        {bills.length === 0 && <li className="p-8 text-center text-muted-foreground">No bills found.</li>}
      </ul>
      {(page > 1 || hasMore) && (
        <div className="flex justify-between text-sm">
          {page > 1 ? <Link className="underline" href={pageLink(page - 1)}>← Newer bills</Link> : <span />}
          {hasMore && <Link className="underline" href={pageLink(page + 1)}>Older bills →</Link>}
        </div>
      )}
    </div>
  );
}
