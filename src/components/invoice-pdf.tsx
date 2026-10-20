/* eslint-disable jsx-a11y/alt-text -- @react-pdf/renderer Image is not an HTML img element */
import path from "node:path";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { Plain } from "@/lib/action-result";
import type { InvoiceView } from "@/domain/invoice-view";
import { formatINR, formatQuantity } from "@/lib/money";

const fontDir = path.join(process.cwd(), "src", "assets", "fonts");
Font.register({
  family: "NotoSans",
  fonts: [
    { src: path.join(fontDir, "NotoSans-Regular.ttf") },
    { src: path.join(fontDir, "NotoSans-Bold.ttf"), fontWeight: "bold" },
  ],
});

const s = StyleSheet.create({
  page: { fontFamily: "NotoSans", fontSize: 9, padding: 28, gap: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 14, fontWeight: "bold", textAlign: "center" },
  box: { border: "1pt solid #999", padding: 6 },
  bold: { fontWeight: "bold" },
  th: { flexDirection: "row", borderBottom: "1pt solid #999", paddingBottom: 3, fontWeight: "bold" },
  tr: { flexDirection: "row", paddingVertical: 2, borderBottom: "0.5pt solid #ddd" },
  c1: { width: "4%" }, c2: { width: "32%" }, c3: { width: "10%" }, c4: { width: "10%", textAlign: "right" },
  c5: { width: "12%", textAlign: "right" }, c6: { width: "8%", textAlign: "right" }, c7: { width: "12%", textAlign: "right" }, c8: { width: "12%", textAlign: "right" },
  qr: { width: 90, height: 90 },
});

type Qrs = { irnQr: string | null; upiQr: string | null };

function InvoicePdfDocument({ view, qrs }: { view: Plain<InvoiceView>; qrs: Qrs }) {
  const t = view.totals;
  return (
    <Document title={`Invoice ${view.invoiceNumber}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>{view.title}</Text>
        <View style={s.row}>
          <View style={[s.box, { flex: 1 }]}>
            <Text style={s.bold}>{view.supplier.name}</Text>
            <Text>{view.supplier.address}</Text>
            <Text>GSTIN: {view.supplier.gstin}   State: {view.supplier.stateLabel}</Text>
            {view.supplier.phone && <Text>Phone: {view.supplier.phone}</Text>}
          </View>
          <View style={[s.box, { width: 180 }]}>
            <Text>Invoice No: <Text style={s.bold}>{view.invoiceNumber}</Text></Text>
            <Text>Date: {view.invoiceDate}</Text>
            <Text>Place of supply: {view.placeOfSupplyLabel}</Text>
            <Text>Reverse charge: {view.reverseCharge}</Text>
          </View>
        </View>
        <View style={s.box}>
          <Text style={s.bold}>Bill to: {view.customer.name}</Text>
          <Text>{view.customer.address}</Text>
          <Text>{view.customer.gstin ? `GSTIN: ${view.customer.gstin}` : "Unregistered"}   State: {view.customer.stateLabel}</Text>
          {view.deliveryAddress && <Text>Ship to: {view.deliveryAddress}</Text>}
        </View>
        <View>
          <View style={s.th}>
            <Text style={s.c1}>#</Text><Text style={s.c2}>Item</Text><Text style={s.c3}>HSN</Text><Text style={s.c4}>Qty</Text>
            <Text style={s.c5}>Rate</Text><Text style={s.c6}>GST%</Text><Text style={s.c7}>Taxable</Text><Text style={s.c8}>Amount</Text>
          </View>
          {view.lines.map((l) => (
            <View key={l.id} style={s.tr}>
              <Text style={s.c1}>{l.lineNo}</Text><Text style={s.c2}>{l.productName}</Text><Text style={s.c3}>{l.hsnCode}</Text>
              <Text style={s.c4}>{formatQuantity(l.quantity)} {l.unit}</Text><Text style={s.c5}>{formatINR(l.unitPrice)}</Text>
              <Text style={s.c6}>{formatQuantity(l.gstRate)}</Text><Text style={s.c7}>{formatINR(l.taxableValue)}</Text><Text style={s.c8}>{formatINR(l.lineTotal)}</Text>
            </View>
          ))}
        </View>
        <View style={s.row}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.bold}>Tax summary</Text>
            {view.taxSummary.map((r) => (
              <Text key={`${r.hsnCode}-${r.gstRate}`}>
                HSN {r.hsnCode} @ {r.gstRate}%: taxable {formatINR(r.taxableValue)}
                {view.interState ? `, IGST ${formatINR(r.igstAmount)}` : `, CGST ${formatINR(r.cgstAmount)}, SGST ${formatINR(r.sgstAmount)}`}
              </Text>
            ))}
            <Text>Amount in words: {view.amountInWords}</Text>
            {view.bankDetails && <Text>Bank: {view.bankDetails}</Text>}
            {view.terms && <Text>Terms: {view.terms}</Text>}
          </View>
          <View style={[s.box, { width: 180, gap: 2 }]}>
            {Number(t.discountTotal) > 0 && <View style={s.row}><Text>Discount</Text><Text>-{formatINR(t.discountTotal)}</Text></View>}
            <View style={s.row}><Text>Taxable value</Text><Text>{formatINR(t.taxableTotal)}</Text></View>
            {view.interState
              ? <View style={s.row}><Text>IGST</Text><Text>{formatINR(t.igstTotal)}</Text></View>
              : <><View style={s.row}><Text>CGST</Text><Text>{formatINR(t.cgstTotal)}</Text></View><View style={s.row}><Text>SGST</Text><Text>{formatINR(t.sgstTotal)}</Text></View></>}
            <View style={s.row}><Text>Round off</Text><Text>{formatINR(t.roundOff)}</Text></View>
            <View style={s.row}><Text style={s.bold}>Total</Text><Text style={s.bold}>{formatINR(t.grandTotal)}</Text></View>
          </View>
        </View>
        <View style={s.row}>
          <View style={{ flexDirection: "row", gap: 12 }}>
            {qrs.irnQr && <View><Image style={s.qr} src={qrs.irnQr} /><Text>e-Invoice QR</Text></View>}
            {qrs.upiQr && <View><Image style={s.qr} src={qrs.upiQr} /><Text>Scan to pay {formatINR(view.payment.amountDue)}</Text></View>}
          </View>
          <View style={{ alignItems: "flex-end", justifyContent: "flex-end" }}>
            <Text>For {view.supplier.name}</Text>
            <Text style={{ marginTop: 28 }}>Authorised signatory</Text>
          </View>
        </View>
        {view.irp?.irn && <Text>IRN: {view.irp.irn}   Ack No: {view.irp.ackNumber}   Ack Date: {view.irp.ackDate}</Text>}
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(view: Plain<InvoiceView>, qrs: Qrs): Promise<Buffer> {
  return renderToBuffer(<InvoicePdfDocument view={view} qrs={qrs} />);
}
