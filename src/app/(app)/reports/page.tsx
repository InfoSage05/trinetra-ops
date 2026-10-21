import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { getSession } from "@/lib/session";
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
      <h1 className="text-xl font-semibold">Reports</h1>

      <form className="flex flex-wrap items-end gap-2">
        <label className="text-sm">From<input type="date" name="from" defaultValue={range.from} className="mt-1 block h-11 rounded-md border bg-background px-2" /></label>
        <label className="text-sm">To<input type="date" name="to" defaultValue={range.to} className="mt-1 block h-11 rounded-md border bg-background px-2" /></label>
        <button className="h-11 rounded-md border bg-background px-4">Show</button>
        <a href={`/api/reports/sales-register?${query}`} className={buttonVariants({ variant: "outline" })}>Download sales register (CSV)</a>
        <a href={`/api/reports/hsn-summary?${query}`} className={buttonVariants({ variant: "outline" })}>Download HSN summary (CSV)</a>
      </form>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {sales && (
        <section className="space-y-3" data-testid="sales-summary">
          <h2 className="font-semibold">Sales</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Bills" value={String(sales.billCount)} />
            <Tile label="Billed" value={formatINR(sales.billed)} />
            <Tile label="Returned (credit notes)" value={formatINR(sales.credited)} />
            <Tile label="Net sales" value={formatINR(sales.netSales)} />
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
          {AGEING_BUCKETS.map((b) => <Tile key={b} label={`${b} days`} value={formatINR(ageing.totals[b])} />)}
          <Tile label="Total" value={formatINR(ageing.grandTotal)} />
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

function Tile({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border bg-background p-3"><p className="text-xs uppercase text-muted-foreground">{label}</p><p className="text-lg font-semibold">{value}</p></div>;
}

function Table({ title, head, rows, link }: { title: string; head: string[]; rows: string[][]; link?: (row: number) => string }) {
  return (
    <div className="space-y-1">
      {title && <h3 className="text-sm font-medium">{title}</h3>}
      <div className="overflow-x-auto rounded-md border bg-background">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/50 text-left">{head.map((h, i) => <th key={h} className={`px-3 py-2 font-medium ${i > 0 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b last:border-0">
                {row.map((cell, c) => (
                  <td key={c} className={`px-3 py-2 ${c > 0 ? "text-right tabular-nums" : ""}`}>
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
