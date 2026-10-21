import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { getSession } from "@/lib/session";
import { formatINR } from "@/lib/money";
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
      <div className="flex items-center"><h1 className="mr-auto text-xl font-semibold">Bills</h1><Link className="underline" href="/billing/new">New bill</Link></div>
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Invoice no. or customer" className="h-11 flex-1 rounded-md border bg-background px-3" />
        <select name="status" defaultValue={validStatus ?? ""} className="h-11 rounded-md border bg-background px-2">
          <option value="">All</option><option value="DUE">Money due (unpaid + part paid)</option><option value="UNPAID">Unpaid</option><option value="PARTIAL">Part paid</option><option value="PAID">Paid</option>
        </select>
        <button className="h-11 rounded-md border bg-background px-4">Search</button>
      </form>
      <ul className="divide-y rounded-md border bg-background">
        {bills.map((b) => (
          <li key={b.id}>
            <Link href={`/bills/${b.id}`} className="flex flex-wrap items-center gap-2 p-3 hover:bg-muted/50">
              <div className="mr-auto"><p className="font-medium">{b.invoiceNumber} · {b.customerName}</p><p className="text-sm text-muted-foreground">{formatDateIN(b.billDate)}</p></div>
              <div className="text-right"><p className="font-medium">{formatINR(b.grandTotal)}</p>
                <Badge variant={b.payment.status === "PAID" ? "secondary" : "destructive"}>{STATUS_LABEL[b.payment.status]}{b.payment.status !== "PAID" ? ` · due ${formatINR(b.payment.amountDue)}` : ""}</Badge></div>
            </Link>
          </li>
        ))}
        {bills.length === 0 && <li className="p-6 text-center text-muted-foreground">No bills found.</li>}
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
