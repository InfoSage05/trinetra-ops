import type { Plain } from "@/lib/action-result";
import type { InvoiceView } from "@/domain/invoice-view";
import { formatAmount, formatQuantity } from "@/lib/money";

type Props = { view: Plain<InvoiceView>; qrs: { irnQr: string | null; upiQr: string | null } };

const MIN_ROWS = 15;
const cell = "border border-black px-1 py-0.5 align-top";
const head = `${cell} bg-neutral-100 text-center text-[10px] font-bold uppercase leading-tight`;
const num = `${cell} text-right tabular-nums`;

/** The printed tax invoice, laid out like the owner's paper template (new in voice.xlsx). */
export function InvoiceSheet({ view, qrs }: Props) {
  const t = view.totals;
  const blankRows = Math.max(0, MIN_ROWS - view.lines.length);
  const charge = (kind: string) => view.charges.find((c) => c.kind === kind);
  const chargeRows: { label: string; kind: string }[] = [
    { label: "TOTAL CARTON CHARGES", kind: "CARTON" },
    { label: "EXTRA CRATE CHARGES", kind: "CRATE" },
    { label: "FREIGHT CHARGES", kind: "FREIGHT" },
  ];
  const otherCharges = view.charges.filter((c) => c.kind === "OTHER");
  const totalCartons = view.lines.reduce((sum, l) => sum + Number(l.cartons), 0);
  const totalQty = view.lines.reduce((sum, l) => sum + Number(l.quantity), 0);

  return (
    <article className="invoice-a4 mx-auto w-full min-w-[720px] max-w-[210mm] bg-white p-3 text-[11px] leading-snug text-black">
      <table className="w-full border-collapse">
        <colgroup>
          {[4, 22, 7, 7, 7, 8, 5, 8, 8, 8, 8, 8].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
        </colgroup>
        <tbody>
          <tr><td colSpan={12} className={`${cell} text-center text-sm font-bold`}>{view.title}</td></tr>
          <tr>
            <td colSpan={8} rowSpan={2} className={`${cell}`}>
              <p className="text-base font-bold uppercase">{view.supplier.name}</p>
              <p className="uppercase">{view.supplier.address}</p>
              {view.supplier.phone && <p>Mobile: {view.supplier.phone}</p>}
            </td>
            <td colSpan={2} className={`${cell} font-bold`}>INVOICE NO</td>
            <td colSpan={2} className={cell}>{view.invoiceNumber}</td>
          </tr>
          <tr>
            <td colSpan={2} className={`${cell} font-bold`}>INVOICE DATE</td>
            <td colSpan={2} className={cell}>{view.invoiceDate}</td>
          </tr>
          <tr>
            <td colSpan={2} className={`${cell} font-bold`}>GST NO</td>
            <td colSpan={6} className={cell}>{view.supplier.gstin}</td>
            <td colSpan={2} className={`${cell} font-bold`}>PLACE OF SUPPLY</td>
            <td colSpan={2} className={cell}>{view.placeOfSupplyLabel}</td>
          </tr>
          <tr>
            <td colSpan={3} className={`${cell} font-bold`}>NAME OF THE PURCHASER</td>
            <td colSpan={9} className={cell}>{view.customer.name}</td>
          </tr>
          <tr>
            <td colSpan={3} className={`${cell} font-bold`}>MOBILE NO</td>
            <td colSpan={3} className={cell}>{view.customer.phone ?? ""}</td>
            <td colSpan={1} className={`${cell} font-bold`}>ADDRESS</td>
            <td colSpan={5} rowSpan={2} className={cell}>
              {view.customer.address}
              {view.deliveryAddress && <span className="block">Deliver to: {view.deliveryAddress}</span>}
            </td>
          </tr>
          <tr>
            <td colSpan={3} className={`${cell} font-bold`}>GST NO</td>
            <td colSpan={3} className={cell}>{view.customer.gstin ?? "Unregistered"}</td>
            <td colSpan={1} className={cell}></td>
          </tr>
          <tr>
            {["SL NO", "DESCRIPTION OF GOODS", "HSN / SAC", "NO OF CARTONS", "QTY PER CARTON", "TOTAL QTY", "UNIT", "RATE", "CGST", "SGST", "IGST", "TOTAL AMOUNT"].map((h) => (
              <th key={h} className={head}>{h}</th>
            ))}
          </tr>
          {view.lines.map((l) => (
            <tr key={l.id}>
              <td className={`${cell} text-center`}>{l.lineNo}</td>
              <td className={cell}>{l.productName}{l.shortfallQuantity ? <span className="block text-[9px]">Still owed: {formatQuantity(l.shortfallQuantity)}</span> : null}</td>
              <td className={`${cell} text-center`}>{l.hsnCode}</td>
              <td className={num}>{l.cartons}</td>
              <td className={num}>{l.qtyPerCarton}</td>
              <td className={num}>{formatQuantity(l.quantity)}</td>
              <td className={`${cell} text-center`}>{l.unit}</td>
              <td className={num}>{formatAmount(l.unitPrice)}</td>
              <td className={num}>{Number(l.cgstAmount) ? <>{formatAmount(l.cgstAmount)}<span className="block text-[9px]">{formatQuantity(Number(l.gstRate) / 2)}%</span></> : "-"}</td>
              <td className={num}>{Number(l.sgstAmount) ? <>{formatAmount(l.sgstAmount)}<span className="block text-[9px]">{formatQuantity(Number(l.gstRate) / 2)}%</span></> : "-"}</td>
              <td className={num}>{Number(l.igstAmount) ? <>{formatAmount(l.igstAmount)}<span className="block text-[9px]">{formatQuantity(l.gstRate)}%</span></> : "-"}</td>
              <td className={num}>{formatAmount(l.lineTotal)}</td>
            </tr>
          ))}
          {Array.from({ length: blankRows }, (_, i) => (
            <tr key={`blank-${i}`}>
              {Array.from({ length: 12 }, (_, c) => <td key={c} className={`${cell} h-5`}>{c === 0 ? view.lines.length + i + 1 : ""}</td>)}
            </tr>
          ))}
          <tr>
            <td colSpan={3} className={`${cell} text-right font-bold`}>TOTAL</td>
            <td className={`${num} font-bold`}>{formatQuantity(totalCartons)}</td>
            <td className={cell}></td>
            <td className={`${num} font-bold`}>{formatQuantity(totalQty)}</td>
            <td colSpan={2} className={cell}></td>
            <td className={`${num} font-bold`}>{view.interState ? "-" : formatAmount(view.lines.reduce((s, l) => s + Number(l.cgstAmount), 0))}</td>
            <td className={`${num} font-bold`}>{view.interState ? "-" : formatAmount(view.lines.reduce((s, l) => s + Number(l.sgstAmount), 0))}</td>
            <td className={`${num} font-bold`}>{view.interState ? formatAmount(view.lines.reduce((s, l) => s + Number(l.igstAmount), 0)) : "-"}</td>
            <td className={`${num} font-bold`}>{formatAmount(view.lines.reduce((s, l) => s + Number(l.lineTotal), 0))}</td>
          </tr>
          {[...chargeRows.map((r) => ({ ...r, c: charge(r.kind) })), ...otherCharges.map((c) => ({ label: c.label.toUpperCase(), kind: c.kind, c }))].map((r, i) => (
            <tr key={`${r.kind}-${i}`}>
              <td colSpan={3} className={`${cell} font-bold`}>{r.label}</td>
              <td colSpan={5} className={`${num}`}>{r.c ? <><span className="mr-2 font-bold">AMOUNT</span>{formatAmount(r.c.taxableValue)}</> : <span className="mr-2 font-bold">AMOUNT</span>}</td>
              <td className={num}>{r.c && Number(r.c.cgstAmount) ? formatAmount(r.c.cgstAmount) : ""}</td>
              <td className={num}>{r.c && Number(r.c.sgstAmount) ? formatAmount(r.c.sgstAmount) : ""}</td>
              <td className={num}>{r.c && Number(r.c.igstAmount) ? formatAmount(r.c.igstAmount) : ""}</td>
              <td className={num}>{r.c ? formatAmount(r.c.lineTotal) : ""}</td>
            </tr>
          ))}
          {Number(t.roundOff) !== 0 && (
            <tr>
              <td colSpan={11} className={`${cell} text-right font-bold`}>ROUND OFF</td>
              <td className={num}>{formatAmount(t.roundOff)}</td>
            </tr>
          )}
          <tr>
            <td colSpan={3} className={`${cell} font-bold`}>INVOICE VALUE (IN WORDS)</td>
            <td colSpan={6} className={`${cell}`}>{view.amountInWords}</td>
            <td colSpan={2} className={`${cell} text-right font-bold`}>GRAND TOTAL</td>
            <td className={`${num} text-sm font-bold`}>{formatAmount(t.grandTotal)}</td>
          </tr>
          <tr>
            <td colSpan={6} className={cell}>
              <p className="font-bold">TERMS &amp; CONDITIONS</p>
              {view.termsLines.map((line, i) => <p key={i}>{line}</p>)}
            </td>
            <td colSpan={6} className={cell}>
              <div className="flex flex-col gap-2">
                <div>
                  <p className="font-bold">Tax summary</p>
                  {view.taxSummary.map((r) => (
                    <p key={`${r.hsnCode}-${r.gstRate}`}>
                      {r.hsnCode} @ {r.gstRate}%: {formatAmount(r.taxableValue)} + tax {formatAmount(Number(r.cgstAmount) + Number(r.sgstAmount) + Number(r.igstAmount))}
                    </p>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* eslint-disable @next/next/no-img-element -- QR codes are inline data URLs */}
                  {qrs.irnQr && <figure className="text-center"><img src={qrs.irnQr} alt="e-invoice QR" className="h-20 w-20" /><figcaption className="text-[9px]">e-Invoice</figcaption></figure>}
                  {qrs.upiQr && <figure className="text-center"><img src={qrs.upiQr} alt="UPI QR" className="h-20 w-20" /><figcaption className="text-[9px]">Scan to pay {formatAmount(view.payment.amountDue)}</figcaption></figure>}
                  {/* eslint-enable @next/next/no-img-element */}
                </div>
              </div>
            </td>
          </tr>
          <tr>
            <td colSpan={5} rowSpan={2} className={cell}>
              <p className="font-bold">BANK DETAILS</p>
              {view.bankLines.map((line, i) => <p key={i}>{line}</p>)}
            </td>
            <td colSpan={4} className={`${cell} h-16 text-center`}>
              <p className="mt-10 font-bold">Customer seal and Signature</p>
            </td>
            <td colSpan={3} className={`${cell} h-16 text-center`}>
              <p className="mt-10 font-bold">Signature of the Supplier</p>
            </td>
          </tr>
          <tr>
            <td colSpan={7} className={`${cell} text-center text-[9px]`}>
              {view.irp?.irn ? `IRN: ${view.irp.irn} · Ack ${view.irp.ackNumber} · ${view.irp.ackDate}` : `This is a computer generated invoice. For ${view.supplier.name}.`}
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}
