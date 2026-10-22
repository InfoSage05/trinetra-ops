import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { ReportInsights } from "@/components/report-insights";
import { getSession } from "@/lib/session";
import { getLlmClient } from "@/lib/llm";
import { describeStock } from "@/lib/cartons";
import { DomainError } from "@/lib/errors";
import { formatINR, formatQuantity } from "@/lib/money";
import { istDateParts, istToday } from "@/lib/time";
import { AGEING_BUCKETS, getDuesAgeing, getSalesReport, getStockMovementReport } from "@/domain/sales-reports";

type SearchParams = Promise<{ from?: string; to?: string }>;

function monthStart(): string {
  const { year, month } = istDateParts(new Date());
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  const params = await searchParams;
  const range = { from: params.from || monthStart(), to: params.to || istToday() };

  let sales, movement, error: string | null = null;
  try {
    [sales, movement] = await Promise.all([getSalesReport(session, range), getStockMovementReport(session, range)]);
  } catch (e) {
    if (!(e instanceof DomainError) || e.code !== "VALIDATION") throw e;
    error = e.message;
  }
  const ageing = await getDuesAgeing(session);
  const query = new URLSearchParams(range).toString();

  return (
    <div className="space-y-6">
      <h1>Reports</h1>

      <form className="flex flex-wrap items-end gap-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <label className="text-sm font-medium">From<input type="date" name="from" defaultValue={range.from} className="mt-1 block h-10 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30" /></label>
        <label className="text-sm font-medium">To<input type="date" name="to" defaultValue={range.to} className="mt-1 block h-10 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30" /></label>
        <button className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Show</button>
        <a href={`/api/reports/sales-register?${query}`} className={buttonVariants({ variant: "outline", size: "lg" })}>Download sales register (CSV)</a>
        <a href={`/api/reports/hsn-summary?${query}`} className={buttonVariants({ variant: "outline", size: "lg" })}>Download HSN summary (CSV)</a>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <ReportInsights key={`${range.from}:${range.to}`} range={range} aiAvailable={getLlmClient() !== null} />

      {sales && (
        <section className="space-y-3" data-testid="sales-summary">
          <h2 className="font-semibold">Sales</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Bills" value={String(sales.billCount)} />
            <Tile label="Billed" value={formatINR(sales.billed)} tone="info" />
            <Tile label="Returned (credit notes)" value={formatINR(sales.credited)} tone="destructive" />
            <Tile label="Net sales" value={formatINR(sales.netSales)} tone="success" />
          </div>
          <p className="text-sm text-muted-foreground">Taxable {formatINR(sales.taxable)} · CGST {formatINR(sales.cgst)} · SGST {formatINR(sales.sgst)} · IGST {formatINR(sales.igst)}</p>

          <Table title="By item" head={["Item", "Qty (pcs)", "Amount"]} rows={sales.byProduct.map((p) => [p.name, formatQuantity(p.quantity), formatINR(p.total)])} />
          <Table title="By customer" head={["Customer", "Bills", "Amount"]} rows={sales.byCustomer.map((c) => [c.name, String(c.bills), formatINR(c.total)])} />
          <Table title="By day" head={["Date", "Bills", "Amount"]} rows={sales.byDay.map((d) => [d.day, String(d.bills), formatINR(d.total)])} />
        </section>
      )}

      <section className="space-y-3" data-testid="dues-ageing">
        <h2 className="font-semibold">Money to collect, by how old the bill is</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {AGEING_BUCKETS.map((b, i) => <Tile key={b} label={`${b} days`} value={formatINR(ageing.totals[b])} tone={AGEING_TONES[i]} />)}
          <Tile label="Total" value={formatINR(ageing.grandTotal)} tone="warning" />
        </div>
        <Table
          title="Customers" head={["Customer", ...AGEING_BUCKETS.map((b) => `${b} d`), "Total"]}
          rows={ageing.customers.map((c) => [c.name, ...AGEING_BUCKETS.map((b) => formatINR(c.buckets[b])), formatINR(c.total)])}
          link={(i) => `/customers/${ageing.customers[i].customerId}`}
        />
      </section>

      {movement && (
        <section className="space-y-3">
          <h2 className="font-semibold">Stock movement</h2>
          <Table
            title="" head={["Item", "Opening", "Made", "Sold", "Returned", "Corrected", "Closing"]}
            rows={movement.items.map((i) => [i.name, ...[i.opening, i.produced, i.sold, i.returned, i.adjusted].map((v) => formatQuantity(v)), describeStock(i.closing.toString(), i.qtyPerCarton)])}
          />
          <p className="text-xs text-muted-foreground">All quantities are in pieces except Closing, which also shows cartons.</p>
        </section>
      )}
      <p className="text-sm"><Link href="/dashboard" className="underline">← Home</Link></p>
    </div>
  );
}

type TileTone = "default" | "success" | "warning" | "destructive" | "info";
const TILE_TONES: Record<Exclude<TileTone, "default">, string> = {
  success: "bg-success/10 ring-success/30",
  warning: "bg-warning/10 ring-warning/30",
  destructive: "bg-destructive/10 ring-destructive/25",
  info: "bg-info/10 ring-info/30",
};
/** Money ages in one direction: the older the bucket, the louder the tint. */
const AGEING_TONES: TileTone[] = ["default", "info", "warning", "destructive"];

function Tile({ label, value, tone = "default" }: { label: string; value: string; tone?: TileTone }) {
  return <div className={cn("rounded-xl p-3.5 ring-1 shadow-[0_1px_2px_rgb(64_38_16/0.04)]", tone === "default" ? "bg-card ring-foreground/10" : TILE_TONES[tone])}><p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p><p className="mt-1 text-lg font-bold tabular-nums">{value}</p></div>;
}

function Table({ title, head, rows, link }: { title: string; head: string[]; rows: string[][]; link?: (row: number) => string }) {
  return (
    <div className="space-y-1">
      {title && <h3 className="text-sm font-medium">{title}</h3>}
      <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10 shadow-[0_1px_2px_rgb(64_38_16/0.04)]">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/60 text-left">{head.map((h, i) => <th key={h} className={`px-3 py-2.5 font-medium ${i > 0 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-border/70 last:border-0 transition-colors hover:bg-amber-500/[0.05]">
                {row.map((cell, c) => (
                  <td key={c} className={`px-3 py-2.5 ${c > 0 ? "text-right tabular-nums" : "font-medium"}`}>
                    {c === 0 && link ? <Link href={link(r)} className="underline">{cell}</Link> : cell}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={head.length} className="px-3 py-4 text-center text-muted-foreground">Nothing in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
