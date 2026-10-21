import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { NotFoundError } from "@/lib/errors";
import { stateName } from "@/lib/gst";
import { D, amountInWords, formatQuantity, sumDecimals } from "@/lib/money";
import { formatDateIN } from "@/lib/time";
import { getBusinessProfile } from "@/domain/settings";
import { getPaymentSummary } from "@/domain/payments";

/** Free-text settings (terms, bank details) printed one line per row. */
export function splitLines(text: string | null | undefined): string[] {
  return (text ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

export async function getInvoiceView(session: Session | null, billId: string) {
  requireRole(session, ["OWNER"]);
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: {
      lineItems: { orderBy: { lineNo: "asc" } },
      charges: { orderBy: { chargeNo: "asc" } },
      payments: { orderBy: { paidAt: "asc" } },
      creditNotes: { orderBy: { noteDate: "asc" }, include: { lines: true } },
      irpSubmission: true,
    },
  });
  if (!bill) throw new NotFoundError("Bill");
  const profile = await getBusinessProfile(prisma);
  const payment = await getPaymentSummary(prisma, bill.id);

  // HSN-wise tax summary (one row per HSN + rate), as commonly printed on Indian GST invoices.
  const groups = new Map<string, typeof bill.lineItems>();
  for (const line of bill.lineItems) {
    const key = `${line.hsnCode}|${D(line.gstRate).toString()}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  const chargeGroups = new Map<string, typeof bill.charges>();
  for (const charge of bill.charges) {
    const key = D(charge.gstRate).toString();
    chargeGroups.set(key, [...(chargeGroups.get(key) ?? []), charge]);
  }
  const taxSummary = [
    ...[...groups.entries()].map(([key, lines]) => {
      const [hsnCode, gstRate] = key.split("|");
      return {
        hsnCode, gstRate,
        taxableValue: sumDecimals(lines.map((l) => l.taxableValue)),
        cgstAmount: sumDecimals(lines.map((l) => l.cgstAmount)),
        sgstAmount: sumDecimals(lines.map((l) => l.sgstAmount)),
        igstAmount: sumDecimals(lines.map((l) => l.igstAmount)),
      };
    }),
    // Packing/freight charges are shown under their own rate so the summary adds up to the invoice.
    ...[...chargeGroups.entries()].map(([gstRate, charges]) => ({
      hsnCode: "Charges", gstRate,
      taxableValue: sumDecimals(charges.map((c) => c.taxableValue)),
      cgstAmount: sumDecimals(charges.map((c) => c.cgstAmount)),
      sgstAmount: sumDecimals(charges.map((c) => c.sgstAmount)),
      igstAmount: sumDecimals(charges.map((c) => c.igstAmount)),
    })),
  ];

  const due = payment.amountDue;
  const upiPayUri = profile?.upiId && due.greaterThan(0)
    ? `upi://pay?pa=${encodeURIComponent(profile.upiId)}&pn=${encodeURIComponent(profile.tradeName ?? profile.legalName)}&am=${due.toFixed(2)}&cu=INR&tn=${encodeURIComponent(bill.invoiceNumber)}`
    : null;

  return {
    id: bill.id,
    title: bill.customerGstin ? "TAX INVOICE" : "TAX INVOICE (B2C)",
    invoiceNumber: bill.invoiceNumber,
    invoiceDate: formatDateIN(bill.billDate),
    supplier: {
      name: bill.supplierLegalName, gstin: bill.supplierGstin, address: bill.supplierAddress,
      stateLabel: `${stateName(bill.supplierStateCode)} (${bill.supplierStateCode})`,
      phone: profile?.phone ?? null, email: profile?.email ?? null,
    },
    customer: {
      name: bill.customerName, gstin: bill.customerGstin, address: bill.customerAddress, phone: bill.customerPhone,
      stateLabel: `${stateName(bill.customerStateCode)} (${bill.customerStateCode})`,
    },
    placeOfSupplyLabel: `${stateName(bill.placeOfSupply)} (${bill.placeOfSupply})`,
    deliveryAddress: bill.deliveryAddress || null,
    interState: bill.supplierStateCode !== bill.placeOfSupply,
    reverseCharge: bill.reverseCharge ? "Yes" : "No",
    lines: bill.lineItems.map((l) => ({ ...l, cartons: formatQuantity(D(l.quantity).div(l.qtyPerCarton)) })),
    charges: bill.charges,
    taxSummary,
    totals: {
      grossTotal: bill.grossTotal, discountTotal: bill.discountTotal, taxableTotal: bill.taxableTotal,
      cgstTotal: bill.cgstTotal, sgstTotal: bill.sgstTotal, igstTotal: bill.igstTotal,
      taxTotal: bill.taxTotal, roundOff: bill.roundOff, grandTotal: bill.grandTotal,
    },
    amountInWords: amountInWords(bill.grandTotal),
    payment,
    payments: bill.payments,
    creditNotes: bill.creditNotes.map((n) => ({ id: n.id, number: n.creditNoteNumber, date: formatDateIN(n.noteDate), reason: n.reason, grandTotal: n.grandTotal, restock: n.restock, lines: n.lines })),
    irp: bill.irpSubmission
      ? { status: bill.irpSubmission.status, irn: bill.irpSubmission.irn, ackNumber: bill.irpSubmission.ackNumber,
          ackDate: bill.irpSubmission.ackDate ? formatDateIN(bill.irpSubmission.ackDate) : null, signedQrCode: bill.irpSubmission.signedQrCode,
          lastError: bill.irpSubmission.lastError, submissionId: bill.irpSubmission.id }
      : null,
    upiPayUri,
    bankDetails: profile?.bankDetails ?? null,
    bankLines: splitLines(profile?.bankDetails),
    terms: profile?.invoiceTerms ?? null,
    termsLines: splitLines(profile?.invoiceTerms),
    notes: bill.notes,
  };
}

export type InvoiceView = Awaited<ReturnType<typeof getInvoiceView>>;

export async function getCreditNoteView(session: Session | null, creditNoteId: string) {
  requireRole(session, ["OWNER"]);
  const note = await prisma.creditNote.findUnique({
    where: { id: creditNoteId },
    include: { bill: true, lines: { include: { billLineItem: true } }, irpSubmission: true },
  });
  if (!note) throw new NotFoundError("Credit note");
  const bill = note.bill;
  const interState = bill.supplierStateCode !== bill.placeOfSupply;
  return {
    id: note.id,
    title: bill.customerGstin ? "CREDIT NOTE" : "CREDIT NOTE (B2C)",
    creditNoteNumber: note.creditNoteNumber,
    creditNoteDate: formatDateIN(note.noteDate),
    originalInvoiceNumber: bill.invoiceNumber,
    originalInvoiceDate: formatDateIN(bill.billDate),
    reason: note.reason,
    supplier: {
      name: bill.supplierLegalName, gstin: bill.supplierGstin, address: bill.supplierAddress,
      stateLabel: `${stateName(bill.supplierStateCode)} (${bill.supplierStateCode})`,
    },
    customer: {
      name: bill.customerName, gstin: bill.customerGstin, address: bill.customerAddress,
      stateLabel: `${stateName(bill.customerStateCode)} (${bill.customerStateCode})`,
    },
    placeOfSupplyLabel: `${stateName(bill.placeOfSupply)} (${bill.placeOfSupply})`,
    interState,
    lines: note.lines.map((l) => ({
      id: l.id, productName: l.billLineItem.productName, hsnCode: l.billLineItem.hsnCode, unit: l.billLineItem.unit,
      quantity: l.quantity, unitPrice: l.billLineItem.unitPrice, gstRate: l.billLineItem.gstRate,
      taxableValue: l.taxableValue, cgstAmount: l.cgstAmount, sgstAmount: l.sgstAmount, igstAmount: l.igstAmount, lineTotal: l.lineTotal,
    })),
    totals: {
      taxableTotal: note.taxableTotal, cgstTotal: note.cgstTotal, sgstTotal: note.sgstTotal, igstTotal: note.igstTotal,
      taxTotal: note.taxTotal, roundOff: note.roundOff, grandTotal: note.grandTotal,
    },
    amountInWords: amountInWords(note.grandTotal),
    restocked: note.restock,
    irp: note.irpSubmission
      ? { status: note.irpSubmission.status, irn: note.irpSubmission.irn, ackNumber: note.irpSubmission.ackNumber }
      : null,
  };
}

export type CreditNoteView = Awaited<ReturnType<typeof getCreditNoteView>>;
