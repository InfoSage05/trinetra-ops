import Link from "next/link";
import { HandCoins, IndianRupee, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TriangleAlert } from "lucide-react";
import { cn } from "cn";
import type { Plain } from "@/lib/action-result";
import type { getOwnerDashboard } from "@/domain/reports";
import { formatINR, formatQuantity } from "@/lib/money";
import { D } from "@/lib/money";
import { formatDateIN } from "@/lib/time";

type Data = Plain<Awaited<ReturnType<typeof getOwnerDashboard>>>;

export function OwnerDashboard({ data }: { data: Data }) {
  const attention = data.negativeStock.length + data.irpIssues.length + data.pendingCounts.length;
  return (
    <div className="space-y-5">
      <div className="flex items-center">
        <div className="mr-auto">
          <h1>Home</h1>
          <p className="text-sm text-muted-foreground">{formatDateIN(new Date())}</p>
        </div>
      </div>
      <Link
        href="/billing/new"
        className={`${buttonVariants({ size: "lg" })} h-14 w-full rounded-xl text-lg font-semibold shadow-[0_10px_30px_-12px_color-mix(in_oklab,var(--color-primary)_60%,transparent)] transition-transform hover:-translate-y-px hover:shadow-[0_14px_34px_-12px_color-mix(in_oklab,var(--color-primary)_70%,transparent)] active:translate-y-0`}
      >
        + New bill
      </Link>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat color="from-amber-100 to-orange-50 dark:from-amber-950/40" icon={<Chip className="bg-amber-500 text-white shadow-sm" icon={<IndianRupee className="size-5" />} />} label="Today's sales" value={formatINR(data.today.salesTotal)} />
        <Stat color="from-sky-100 to-blue-50 dark:from-sky-950/40" icon={<Chip className="bg-sky-500 text-white shadow-sm" icon={<ReceiptText className="size-5" />} />} label="Bills today" value={String(data.today.billCount)} />
        <Stat color={D(data.totalDue).isZero() ? "from-emerald-100 to-green-50 dark:from-emerald-950/40" : "from-rose-100 to-orange-50 dark:from-rose-950/40"} icon={<Chip className={cn("bg-rose-500 text-white shadow-sm", D(data.totalDue).isZero() && "bg-emerald-500")} icon={<HandCoins className="size-5" />} />} label="Money to collect" value={formatINR(data.totalDue)} href="/bills?status=DUE" tone={D(data.totalDue).isZero() ? undefined : "warn"} />
      </div>

      {attention > 0 && (
        <Card className="border-destructive/40 bg-destructive/[0.04]" data-testid="needs-attention">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <TriangleAlert className="size-4" /> Needs attention
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            {data.negativeStock.map((s) => (
              <p key={s.id} className="leading-relaxed"><Badge variant="destructive">Oversold</Badge> <Link className="underline font-medium" href={`/inventory/${s.id}`}>{s.name}</Link>: stock {formatQuantity(s.stock)}. Record production or count it.</p>
            ))}
            {data.irpIssues.map((j) => (
              <p key={j.id} className="leading-relaxed"><Badge variant="destructive">e-Invoice</Badge> {j.documentNumber}: {j.status.toLowerCase()} {j.lastError ? `(${j.lastError})` : ""}{" "}
                {j.billId && <Link className="underline font-medium" href={`/bills/${j.billId}`}>Open</Link>}</p>
            ))}
            {data.pendingCounts.length > 0 && (
              <p className="leading-relaxed"><Badge>Counts</Badge> {data.pendingCounts.length} stock count(s) waiting. <Link className="underline font-medium" href="/inventory/counts">Review</Link></p>
            )}
          </CardContent>
        </Card>
      )}

      {data.orderReminders.length > 0 && (
        <Card data-testid="order-reminders">
          <CardHeader><CardTitle>Orders to deliver soon</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            {data.orderReminders.map((o) => (
              <p key={o.id} className="flex flex-wrap items-center gap-2">
                <Link className="mr-auto underline font-medium" href={`/orders/${o.id}`}>{o.customerName}</Link>
                <span className="tabular-nums">{formatDateIN(new Date(o.dueDate))}</span>
                {o.overdue ? <Badge variant="destructive">Overdue</Badge> : <Badge variant="warning">{o.daysLeft === 0 ? "Today" : o.daysLeft === 1 ? "Tomorrow" : `In ${o.daysLeft} days`}</Badge>}
              </p>
            ))}
            <Link className="underline text-sm" href="/orders">All orders</Link>
          </CardContent>
        </Card>
      )}

      {data.lowStock.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Running low: make more</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            {data.lowStock.map((s) => <p key={s.id} className="leading-relaxed"><Link className="underline font-medium" href={`/inventory/${s.id}`}>{s.name}</Link>: {formatQuantity(s.stock)} left (warn at {formatQuantity(s.reorderLevel)})</p>)}
          </CardContent>
        </Card>
      )}

      {data.topDues.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Who owes money</CardTitle></CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            {data.topDues.map((d) => <p key={d.customerId} className="flex justify-between"><Link className="underline font-medium" href={`/customers/${d.customerId}`}>{d.customerName}</Link><span className="font-semibold tabular-nums">{formatINR(d.amountDue)}</span></p>)}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Chip({ className, icon }: { className: string; icon: React.ReactNode }) {
  return (
    <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", className)}>
      {icon}
    </span>
  );
}

function Stat({ label, value, href, icon, tone, color }: { label: string; value: string; href?: string; icon: React.ReactNode; tone?: "warn"; color?: string }) {
  const body = (
    <Card className={cn("bg-gradient-to-br transition-all hover:-translate-y-0.5 hover:shadow-lg", color ?? "from-card to-card", tone === "warn" && "ring-rose-300")}>
      <CardContent className="flex items-center justify-between gap-2 pt-6">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
        </div>
        {icon}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/60">{body}</Link> : body;
}
