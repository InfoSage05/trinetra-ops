import type { Plain } from "@/lib/action-result";
import type { BillPreview } from "@/domain/billing";
import { D, formatINR, formatQuantity } from "@/lib/money";

type Row = { rate: string; taxable: ReturnType<typeof D>; cgst: ReturnType<typeof D>; sgst: ReturnType<typeof D>; igst: ReturnType<typeof D> };

/** The GST rates on this bill and how much tax each one adds, so the rate is never hidden while making the bill. */
export function GstSummary({ preview }: { preview: Plain<BillPreview> | null }) {
  const rows = new Map<string, Row>();
  for (const part of [...(preview?.lines ?? []), ...(preview?.charges ?? [])]) {
    const rate = formatQuantity(part.gstRate);
    const row = rows.get(rate) ?? { rate, taxable: D(0), cgst: D(0), sgst: D(0), igst: D(0) };
    row.taxable = row.taxable.plus(D(part.taxableValue));
    row.cgst = row.cgst.plus(D(part.cgstAmount));
    row.sgst = row.sgst.plus(D(part.sgstAmount));
    row.igst = row.igst.plus(D(part.igstAmount));
    rows.set(rate, row);
  }
  const list = [...rows.values()].sort((a, b) => Number(a.rate) - Number(b.rate));

  return (
    <div className="rounded-md border bg-background p-4" data-testid="gst-summary">
      <h2 className="mb-2 font-semibold">GST rates on this bill</h2>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add items to see the GST rate and the tax for each rate.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 pr-3 font-medium">GST rate</th>
                <th className="px-3 py-1 text-right font-medium">Amount before tax</th>
                {preview?.interState
                  ? <th className="px-3 py-1 text-right font-medium">IGST</th>
                  : <><th className="px-3 py-1 text-right font-medium">CGST</th><th className="px-3 py-1 text-right font-medium">SGST</th></>}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.rate} className="border-b last:border-0" data-testid="gst-rate-row">
                  <td className="py-1 pr-3 font-medium">{r.rate}%</td>
                  <td className="px-3 py-1 text-right tabular-nums">{formatINR(r.taxable)}</td>
                  {preview?.interState
                    ? <td className="px-3 py-1 text-right tabular-nums">{formatINR(r.igst)}</td>
                    : <><td className="px-3 py-1 text-right tabular-nums">{formatINR(r.cgst)}</td><td className="px-3 py-1 text-right tabular-nums">{formatINR(r.sgst)}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
