import { notFound, redirect } from "next/navigation";
import { toPlain } from "@/lib/action-result";
import { DomainError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { formatINR, formatQuantity } from "@/lib/money";
import { getCreditNoteView } from "@/domain/invoice-view";
import { AutoPrint } from "@/components/auto-print";

export default async function PrintCreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/logout");
  let v;
  try {
    v = toPlain(await getCreditNoteView(session, (await params).id));
  } catch (error) {
    if (error instanceof DomainError) notFound();
    throw error;
  }
  const t = v.totals;
  return (
    <>
      <style>{"@page { size: A4; margin: 10mm; } body { background: white; }"}</style>
      <article className="mx-auto max-w-[210mm] bg-white p-6 text-sm">
        <h1 className="text-center text-base font-bold">{v.title}</h1>
        <section className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <p className="font-semibold">{v.supplier.name}</p>
            <p>{v.supplier.address}</p>
            <p>GSTIN: {v.supplier.gstin}</p>
          </div>
          <div className="text-right">
            <p>Credit note: <b>{v.creditNoteNumber}</b></p>
            <p>Date: {v.creditNoteDate}</p>
            <p>Against invoice: <b>{v.originalInvoiceNumber}</b> dated {v.originalInvoiceDate}</p>
            <p>Place of supply: {v.placeOfSupplyLabel}</p>
          </div>
        </section>
        <section className="mt-3 border-t pt-2">
          <p className="font-semibold">Customer: {v.customer.name}</p>
          <p>{v.customer.address}</p>
          <p>{v.customer.gstin ? `GSTIN: ${v.customer.gstin}` : "Unregistered"} · {v.customer.stateLabel}</p>
          <p className="mt-1">Reason: {v.reason}</p>
        </section>
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="border-b text-left"><th>Item</th><th>HSN</th><th className="text-right">Qty</th><th className="text-right">Rate</th><th className="text-right">GST%</th><th className="text-right">Taxable</th><th className="text-right">Amount</th></tr>
          </thead>
          <tbody>
            {v.lines.map((l) => (
              <tr key={l.id} className="border-b">
                <td>{l.productName}</td><td>{l.hsnCode}</td>
                <td className="text-right">{formatQuantity(l.quantity)} {l.unit}</td>
                <td className="text-right">{formatINR(l.unitPrice)}</td>
                <td className="text-right">{formatQuantity(l.gstRate)}</td>
                <td className="text-right">{formatINR(l.taxableValue)}</td>
                <td className="text-right">{formatINR(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <section className="mt-3 ml-auto w-64 space-y-0.5">
          <Row label="Taxable value" value={formatINR(t.taxableTotal)} />
          {v.interState ? <Row label="IGST" value={formatINR(t.igstTotal)} /> : <><Row label="CGST" value={formatINR(t.cgstTotal)} /><Row label="SGST" value={formatINR(t.sgstTotal)} /></>}
          {Number(t.roundOff) !== 0 && <Row label="Round off" value={formatINR(t.roundOff)} />}
          <Row label="Total credited" value={formatINR(t.grandTotal)} bold />
        </section>
        <p className="mt-2">{v.amountInWords}</p>
        {v.irp?.irn && <p className="mt-2 break-all text-xs">IRN: {v.irp.irn} · Ack {v.irp.ackNumber}</p>}
        <div className="mt-8 text-right"><p>For {v.supplier.name}</p><p className="mt-10">Authorised signatory</p></div>
      </article>
      <AutoPrint />
    </>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? "text-base font-bold" : ""}`}><span>{label}</span><span>{value}</span></div>;
}
