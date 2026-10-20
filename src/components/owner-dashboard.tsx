import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Plain } from "@/lib/action-result";
import type { getOwnerDashboard } from "@/domain/reports";
import { formatINR, formatQuantity } from "@/lib/money";

type Data = Plain<Awaited<ReturnType<typeof getOwnerDashboard>>>;

export function OwnerDashboard({ data }: { data: Data }) {
  const attention = data.negativeStock.length + data.irpIssues.length + data.pendingCounts.length;
  return (
    <div className="space-y-4">
      <Link href="/billing/new" className={`${buttonVariants({ size: "lg" })} h-14 w-full text-lg`}>+ New bill</Link>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Today's sales" value={formatINR(data.today.salesTotal)} />
        <Stat label="Bills today" value={String(data.today.billCount)} />
        <Stat label="Money to collect" value={formatINR(data.totalDue)} href="/bills?status=UNPAID" />
      </div>

      {attention > 0 && (
        <Card className="border-destructive/50">
          <CardHeader><CardTitle>Needs attention</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {data.negativeStock.map((s) => (
              <p key={s.id}><Badge variant="destructive">Oversold</Badge> {s.name}: stock {formatQuantity(s.stock)}. Record production or count it.</p>
            ))}
            {data.irpIssues.map((j) => (
              <p key={j.id}><Badge variant="destructive">e-Invoice</Badge> {j.documentNumber}: {j.status.toLowerCase()} {j.lastError ? `(${j.lastError})` : ""}{" "}
                {j.billId && <Link className="underline" href={`/bills/${j.billId}`}>Open</Link>}</p>
            ))}
            {data.pendingCounts.length > 0 && (
              <p><Badge>Counts</Badge> {data.pendingCounts.length} stock count(s) waiting. <Link className="underline" href="/inventory/counts">Review</Link></p>
            )}
          </CardContent>
        </Card>
      )}

      {data.lowStock.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Running low: make more</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.lowStock.map((s) => <p key={s.id}>{s.name}: {formatQuantity(s.stock)} left (warn at {formatQuantity(s.reorderLevel)})</p>)}
          </CardContent>
        </Card>
      )}

      {data.topDues.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Who owes money</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {data.topDues.map((d) => <p key={d.customerId} className="flex justify-between"><span>{d.customerName}</span><span>{formatINR(d.amountDue)}</span></p>)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <Card><CardContent className="pt-6"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></CardContent></Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
