import type { Plain } from "@/lib/action-result";
import type { InvoiceView } from "@/domain/invoice-view";
import { formatINR, formatQuantity } from "@/lib/money";

type Props = { view: Plain<InvoiceView>; qrs: { irnQr: string | null; upiQr: string | null }; variant: "a4" | "thermal" };

export function InvoiceDocument({ view, qrs, variant }: Props) {
  const t = view.totals;
  const thermal = variant === "thermal";
  return (
    <article className={thermal ? "invoice-thermal mx-auto w-[72mm] text-[11px] leading-tight" : "invoice-a4 mx-auto max-w-[210mm] bg-white p-6 text-sm"}>
      <h1 className="text-center text-base font-bold">{view.title}</h1>
      <section className={thermal ? "text-center" : "mt-3 grid grid-cols-2 gap-4"}>
        <div>
          <p className="font-semibold">{view.supplier.name}</p>
          <p>{view.supplier.address}</p>
          <p>GSTIN: {view.supplier.gstin}</p>
          {view.supplier.phone && <p>Ph: {view.supplier.phone}</p>}
        </div>
        <div className={thermal ? "mt-1" : "text-right"}>
          <p>Invoice: <b>{view.invoiceNumber}</b></p>
          <p>Date: {view.invoiceDate}</p>
          <p>Place of supply: {view.placeOfSupplyLabel}</p>
          <p>Reverse charge: {view.reverseCharge}</p>
        </div>
      </section>
      <section className="mt-3 border-t pt-2">
        <p className="font-semibold">Bill to: {view.customer.name}</p>
        {!thermal && <p>{view.customer.address}</p>}
        <p>{view.customer.gstin ? `GSTIN: ${view.customer.gstin}` : "Unregistered"} · {view.customer.stateLabel}</p>
        {view.deliveryAddress && !thermal && <p>Ship to: {view.deliveryAddress}</p>}
      </section>
      <table className="mt-3 w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th>Item</th>
            {!thermal && <th>HSN</th>}
            <th className="text-right">Qty</th>
            <th className="text-right">Rate</th>
            {!thermal && <th className="text-right">GST%</th>}
            <th className="text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {view.lines.map((l) => (
            <tr key={l.id} className="border-b align-top">
              <td>{l.productName}{l.shortfallQuantity && !thermal ? <span className="block text-xs text-amber-700">Still owed: {formatQuantity(l.shortfallQuantity)}</span> : null}</td>
              {!thermal && <td>{l.hsnCode}</td>}
              <td className="text-right">{formatQuantity(l.quantity)}</td>
              <td className="text-right">{formatINR(l.unitPrice)}</td>
              {!thermal && <td className="text-right">{formatQuantity(l.gstRate)}</td>}
              <td className="text-right">{formatINR(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className={thermal ? "mt-2 space-y-0.5" : "mt-3 ml-auto w-64 space-y-0.5"}>
        {Number(t.discountTotal) > 0 && <Line label="Discount" value={`-${formatINR(t.discountTotal)}`} />}
        <Line label="Taxable value" value={formatINR(t.taxableTotal)} />
        {view.interState ? <Line label="IGST" value={formatINR(t.igstTotal)} /> : <><Line label="CGST" value={formatINR(t.cgstTotal)} /><Line label="SGST" value={formatINR(t.sgstTotal)} /></>}
        <Line label="Round off" value={formatINR(t.roundOff)} />
        <Line label="Total" value={formatINR(t.grandTotal)} bold />
      </section>
      <p className="mt-2">{view.amountInWords}</p>
      {!thermal && view.taxSummary.length > 0 && (
        <table className="mt-3 w-full text-xs">
          <thead><tr className="border-b text-left"><th>HSN</th><th>GST%</th><th className="text-right">Taxable</th><th className="text-right">{view.interState ? "IGST" : "CGST + SGST"}</th></tr></thead>
          <tbody>
            {view.taxSummary.map((r) => (
              <tr key={`${r.hsnCode}-${r.gstRate}`}><td>{r.hsnCode}</td><td>{r.gstRate}</td><td className="text-right">{formatINR(r.taxableValue)}</td>
                <td className="text-right">{view.interState ? formatINR(r.igstAmount) : `${formatINR(r.cgstAmount)} + ${formatINR(r.sgstAmount)}`}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <section className={thermal ? "mt-2 flex flex-col items-center gap-2" : "mt-4 flex items-end justify-between gap-4"}>
        <div className="flex gap-4">
          {/* eslint-disable @next/next/no-img-element -- QR codes are inline data URLs */}
          {qrs.irnQr && <figure className="text-center"><img src={qrs.irnQr} alt="e-invoice QR" className="h-28 w-28" /><figcaption className="text-xs">e-Invoice</figcaption></figure>}
          {qrs.upiQr && <figure className="text-center"><img src={qrs.upiQr} alt="UPI QR" className="h-28 w-28" /><figcaption className="text-xs">Scan to pay {formatINR(view.payment.amountDue)}</figcaption></figure>}
          {/* eslint-enable @next/next/no-img-element */}
        </div>
        {!thermal && <div className="text-right"><p>For {view.supplier.name}</p><p className="mt-10">Authorised signatory</p></div>}
      </section>
      {view.irp?.irn && <p className="mt-2 break-all text-xs">IRN: {view.irp.irn} · Ack {view.irp.ackNumber} · {view.irp.ackDate}</p>}
      {view.terms && <p className="mt-2 text-xs">{view.terms}</p>}
    </article>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? "text-base font-bold" : ""}`}><span>{label}</span><span>{value}</span></div>;
}
