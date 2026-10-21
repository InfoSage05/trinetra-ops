/* eslint-disable jsx-a11y/alt-text -- @react-pdf/renderer Image is not an HTML img element */
import path from "node:path";
import type { ReactNode } from "react";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { Plain } from "@/lib/action-result";
import type { InvoiceView } from "@/domain/invoice-view";
import { formatAmount, formatQuantity } from "@/lib/money";

const fontDir = path.join(process.cwd(), "src", "assets", "fonts");
Font.register({
  family: "NotoSans",
  fonts: [
    { src: path.join(fontDir, "NotoSans-Regular.ttf") },
    { src: path.join(fontDir, "NotoSans-Bold.ttf"), fontWeight: "bold" },
  ],
});

const COLS = [4, 22, 7, 7, 7, 8, 5, 8, 8, 8, 8, 8]; // SL, description, HSN, cartons, per carton, qty, unit, rate, CGST, SGST, IGST, amount
const MIN_ROWS = 15;
const span = (from: number, count: number) => `${COLS.slice(from, from + count).reduce((a, b) => a + b, 0)}%`;

const s = StyleSheet.create({
  page: { fontFamily: "NotoSans", fontSize: 8, padding: 20 },
  table: { borderTop: "0.7pt solid #000", borderLeft: "0.7pt solid #000" },
  row: { flexDirection: "row" },
  cell: { borderRight: "0.7pt solid #000", borderBottom: "0.7pt solid #000", paddingHorizontal: 2, paddingVertical: 1.5 },
  bold: { fontWeight: "bold" },
  center: { textAlign: "center" },
  right: { textAlign: "right" },
  head: { fontWeight: "bold", textAlign: "center", backgroundColor: "#eeeeee", fontSize: 7 },
  qr: { width: 52, height: 52 },
});

type Qrs = { irnQr: string | null; upiQr: string | null };

function Cell({ from, count = 1, style, children }: { from: number; count?: number; style?: object | object[]; children?: ReactNode }) {
  return <View style={[s.cell, { width: span(from, count) }, ...(Array.isArray(style) ? style : style ? [style] : [])]}>{typeof children === "string" || typeof children === "number" ? <Text>{children}</Text> : children}</View>;
}

function InvoicePdfDocument({ view, qrs }: { view: Plain<InvoiceView>; qrs: Qrs }) {
  const t = view.totals;
  const blanks = Math.max(0, MIN_ROWS - view.lines.length);
  const charge = (kind: string) => view.charges.find((c) => c.kind === kind);
  const chargeRows = [
    { label: "TOTAL CARTON CHARGES", c: charge("CARTON") },
    { label: "EXTRA CRATE CHARGES", c: charge("CRATE") },
    { label: "FREIGHT CHARGES", c: charge("FREIGHT") },
    ...view.charges.filter((c) => c.kind === "OTHER").map((c) => ({ label: c.label.toUpperCase(), c })),
  ];
  const sum = (pick: (l: (typeof view.lines)[number]) => string) => view.lines.reduce((acc, l) => acc + Number(pick(l)), 0);
  const dash = (v: string | number, show: boolean) => (show && Number(v) ? formatAmount(v) : "-");

  return (
    <Document title={`Invoice ${view.invoiceNumber}`}>
      <Page size="A4" style={s.page}>
        <View style={s.table}>
          <View style={s.row}><Cell from={0} count={12}><Text style={[s.bold, s.center, { fontSize: 11 }]}>{view.title}</Text></Cell></View>
          <View style={s.row}>
            <View style={{ width: span(0, 8) }}>
              <View style={[s.cell, { height: 46 }]}>
                <Text style={[s.bold, { fontSize: 12 }]}>{view.supplier.name.toUpperCase()}</Text>
                <Text>{view.supplier.address.toUpperCase()}</Text>
                {view.supplier.phone ? <Text>Mobile: {view.supplier.phone}</Text> : null}
              </View>
            </View>
            <View style={{ width: span(8, 4) }}>
              <View style={s.row}><View style={[s.cell, { width: "50%" }]}><Text style={s.bold}>INVOICE NO</Text></View><View style={[s.cell, { width: "50%" }]}><Text>{view.invoiceNumber}</Text></View></View>
              <View style={s.row}><View style={[s.cell, { width: "50%" }]}><Text style={s.bold}>INVOICE DATE</Text></View><View style={[s.cell, { width: "50%" }]}><Text>{view.invoiceDate}</Text></View></View>
            </View>
          </View>
          <View style={s.row}>
            <Cell from={0} count={2}><Text style={s.bold}>GST NO</Text></Cell>
            <Cell from={2} count={6}>{view.supplier.gstin}</Cell>
            <Cell from={8} count={2}><Text style={s.bold}>PLACE OF SUPPLY</Text></Cell>
            <Cell from={10} count={2}>{view.placeOfSupplyLabel}</Cell>
          </View>
          <View style={s.row}>
            <Cell from={0} count={3}><Text style={s.bold}>NAME OF THE PURCHASER</Text></Cell>
            <Cell from={3} count={9}>{view.customer.name}</Cell>
          </View>
          <View style={s.row}>
            <View style={{ width: span(0, 7) }}>
              <View style={s.row}>
                <Cell from={0} count={3}><Text style={s.bold}>MOBILE NO</Text></Cell>
                <Cell from={3} count={4}>{view.customer.phone ?? " "}</Cell>
              </View>
              <View style={s.row}>
                <Cell from={0} count={3}><Text style={s.bold}>GST NO</Text></Cell>
                <Cell from={3} count={4}>{view.customer.gstin ?? "Unregistered"}</Cell>
              </View>
            </View>
            <Cell from={7} count={1}><Text style={s.bold}>ADDRESS</Text></Cell>
            <Cell from={8} count={4}>
              <Text>{view.customer.address}</Text>
              {view.deliveryAddress ? <Text>Deliver to: {view.deliveryAddress}</Text> : null}
            </Cell>
          </View>
          <View style={s.row}>
            {["SL NO", "DESCRIPTION OF GOODS", "HSN / SAC", "NO OF CARTONS", "QTY PER CARTON", "TOTAL QTY", "UNIT", "RATE", "CGST", "SGST", "IGST", "TOTAL AMOUNT"].map((h, i) => (
              <Cell key={h} from={i}><Text style={s.head}>{h}</Text></Cell>
            ))}
          </View>
          {view.lines.map((l) => (
            <View key={l.id} style={s.row} wrap={false}>
              <Cell from={0}><Text style={s.center}>{l.lineNo}</Text></Cell>
              <Cell from={1}><Text>{l.productName}</Text>{l.shortfallQuantity ? <Text style={{ fontSize: 6 }}>Still owed: {formatQuantity(l.shortfallQuantity)}</Text> : null}</Cell>
              <Cell from={2}><Text style={s.center}>{l.hsnCode}</Text></Cell>
              <Cell from={3}><Text style={s.right}>{l.cartons}</Text></Cell>
              <Cell from={4}><Text style={s.right}>{l.qtyPerCarton}</Text></Cell>
              <Cell from={5}><Text style={s.right}>{formatQuantity(l.quantity)}</Text></Cell>
              <Cell from={6}><Text style={s.center}>{l.unit}</Text></Cell>
              <Cell from={7}><Text style={s.right}>{formatAmount(l.unitPrice)}</Text></Cell>
              <Cell from={8}><Text style={s.right}>{dash(l.cgstAmount, true)}</Text></Cell>
              <Cell from={9}><Text style={s.right}>{dash(l.sgstAmount, true)}</Text></Cell>
              <Cell from={10}><Text style={s.right}>{dash(l.igstAmount, true)}</Text></Cell>
              <Cell from={11}><Text style={s.right}>{formatAmount(l.lineTotal)}</Text></Cell>
            </View>
          ))}
          {Array.from({ length: blanks }, (_, i) => (
            <View key={`b${i}`} style={s.row}>
              {COLS.map((_, c) => <Cell key={c} from={c} style={{ height: 13 }}>{c === 0 ? <Text style={s.center}>{view.lines.length + i + 1}</Text> : " "}</Cell>)}
            </View>
          ))}
          <View style={s.row}>
            <Cell from={0} count={3}><Text style={[s.bold, s.right]}>TOTAL</Text></Cell>
            <Cell from={3}><Text style={[s.bold, s.right]}>{formatQuantity(sum((l) => l.cartons))}</Text></Cell>
            <Cell from={4}> </Cell>
            <Cell from={5}><Text style={[s.bold, s.right]}>{formatQuantity(sum((l) => l.quantity))}</Text></Cell>
            <Cell from={6} count={2}> </Cell>
            <Cell from={8}><Text style={[s.bold, s.right]}>{dash(sum((l) => l.cgstAmount), !view.interState)}</Text></Cell>
            <Cell from={9}><Text style={[s.bold, s.right]}>{dash(sum((l) => l.sgstAmount), !view.interState)}</Text></Cell>
            <Cell from={10}><Text style={[s.bold, s.right]}>{dash(sum((l) => l.igstAmount), view.interState)}</Text></Cell>
            <Cell from={11}><Text style={[s.bold, s.right]}>{formatAmount(sum((l) => l.lineTotal))}</Text></Cell>
          </View>
          {chargeRows.map((r, i) => (
            <View key={i} style={s.row} wrap={false}>
              <Cell from={0} count={3}><Text style={s.bold}>{r.label}</Text></Cell>
              <Cell from={3} count={5}><Text style={s.right}>AMOUNT  {r.c ? formatAmount(r.c.taxableValue) : ""}</Text></Cell>
              <Cell from={8}><Text style={s.right}>{r.c && Number(r.c.cgstAmount) ? formatAmount(r.c.cgstAmount) : " "}</Text></Cell>
              <Cell from={9}><Text style={s.right}>{r.c && Number(r.c.sgstAmount) ? formatAmount(r.c.sgstAmount) : " "}</Text></Cell>
              <Cell from={10}><Text style={s.right}>{r.c && Number(r.c.igstAmount) ? formatAmount(r.c.igstAmount) : " "}</Text></Cell>
              <Cell from={11}><Text style={s.right}>{r.c ? formatAmount(r.c.lineTotal) : " "}</Text></Cell>
            </View>
          ))}
          {Number(t.roundOff) !== 0 ? (
            <View style={s.row}>
              <Cell from={0} count={11}><Text style={[s.bold, s.right]}>ROUND OFF</Text></Cell>
              <Cell from={11}><Text style={s.right}>{formatAmount(t.roundOff)}</Text></Cell>
            </View>
          ) : null}
          <View style={s.row} wrap={false}>
            <Cell from={0} count={3}><Text style={s.bold}>INVOICE VALUE (IN WORDS)</Text></Cell>
            <Cell from={3} count={6}>{view.amountInWords}</Cell>
            <Cell from={9} count={2}><Text style={[s.bold, s.right]}>GRAND TOTAL</Text></Cell>
            <Cell from={11}><Text style={[s.bold, s.right, { fontSize: 10 }]}>{formatAmount(t.grandTotal)}</Text></Cell>
          </View>
          <View style={s.row} wrap={false}>
            <Cell from={0} count={6}>
              <Text style={s.bold}>TERMS &amp; CONDITIONS</Text>
              {view.termsLines.map((line, i) => <Text key={i}>{line}</Text>)}
            </Cell>
            <Cell from={6} count={6}>
              <View style={[s.row, { justifyContent: "space-between" }]}>
                <View>
                  <Text style={s.bold}>Tax summary</Text>
                  {view.taxSummary.map((r) => (
                    <Text key={`${r.hsnCode}-${r.gstRate}`}>
                      {r.hsnCode} @ {r.gstRate}%: {formatAmount(r.taxableValue)} + tax {formatAmount(Number(r.cgstAmount) + Number(r.sgstAmount) + Number(r.igstAmount))}
                    </Text>
                  ))}
                </View>
                <View style={s.row}>
                  {qrs.irnQr ? <View><Image style={s.qr} src={qrs.irnQr} /><Text style={{ fontSize: 6 }}>e-Invoice</Text></View> : null}
                  {qrs.upiQr ? <View><Image style={s.qr} src={qrs.upiQr} /><Text style={{ fontSize: 6 }}>Scan to pay {formatAmount(view.payment.amountDue)}</Text></View> : null}
                </View>
              </View>
            </Cell>
          </View>
          <View style={s.row} wrap={false}>
            <Cell from={0} count={5} style={{ height: 62 }}>
              <Text style={s.bold}>BANK DETAILS</Text>
              {view.bankLines.map((line, i) => <Text key={i}>{line}</Text>)}
            </Cell>
            <Cell from={5} count={4} style={{ height: 62 }}><Text style={[s.bold, s.center, { marginTop: 44 }]}>Customer seal and Signature</Text></Cell>
            <Cell from={9} count={3} style={{ height: 62 }}><Text style={[s.bold, s.center, { marginTop: 44 }]}>Signature of the Supplier</Text></Cell>
          </View>
        </View>
        <Text style={{ fontSize: 6, textAlign: "center", marginTop: 3 }}>
          {view.irp?.irn ? `IRN: ${view.irp.irn}   Ack No: ${view.irp.ackNumber}   Ack Date: ${view.irp.ackDate}` : `This is a computer generated invoice. For ${view.supplier.name}.`}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(view: Plain<InvoiceView>, qrs: Qrs): Promise<Buffer> {
  return renderToBuffer(<InvoicePdfDocument view={view} qrs={qrs} />);
}
