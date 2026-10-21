import Decimal from "decimal.js";
import Papa from "papaparse";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { requireRole, type Session } from "@/lib/auth";
import { stateName } from "@/lib/gst";
import { D, ZERO, sumDecimals, toFixed2 } from "@/lib/money";
import { formatDateIN, istRange, istToday } from "@/lib/time";
import { ValidationError } from "@/lib/errors";
import { isoDate, parseInput } from "@/lib/validation";
import { listOutstandingBills } from "@/domain/payments";

/** Owner-only reports over a date range (IST days, both ends included). Totals are summed in the database. */

const MAX_DAYS = 400;

const rangeSchema = z
  .object({ from: isoDate, to: isoDate })
  .superRefine((r, ctx) => {
    if (r.from > r.to) ctx.addIssue({ code: "custom", message: "The start date must be on or before the end date.", path: ["from"] });
    else if ((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 > MAX_DAYS) ctx.addIssue({ code: "custom", message: `Choose a range of at most ${MAX_DAYS} days.`, path: ["to"] });
  });

function parseRange(rawInput: unknown) {
  const { from, to } = parseInput(rangeSchema, rawInput);
  return { from, to, ...istRange(from, to) };
}

type Money = Decimal;
const sum = (v: Prisma.Decimal | null | undefined): Money => D(v ?? 0);

// ── Sales summary ────────────────────────────────────────────────────────────────────────────────────────────

export async function getSalesReport(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { from, to, start, end } = parseRange(rawInput);
  const billWhere = { billDate: { gte: start, lt: end } };

  const [bills, credits, byDay, byProduct, byCustomer] = await Promise.all([
    prisma.bill.aggregate({ where: billWhere, _count: true, _sum: { taxableTotal: true, cgstTotal: true, sgstTotal: true, igstTotal: true, roundOff: true, grandTotal: true } }),
    prisma.creditNote.aggregate({ where: { noteDate: { gte: start, lt: end } }, _count: true, _sum: { taxableTotal: true, taxTotal: true, grandTotal: true } }),
    prisma.$queryRaw<{ day: string; bills: number; total: string }[]>(Prisma.sql`
      SELECT to_char("billDate" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day, COUNT(*)::int AS bills, SUM("grandTotal")::text AS total
      FROM bills WHERE "billDate" >= ${start} AND "billDate" < ${end} GROUP BY 1 ORDER BY 1`),
    prisma.billLineItem.groupBy({
      by: ["productId", "productName"], where: { bill: billWhere },
      _sum: { quantity: true, taxableValue: true, lineTotal: true },
    }),
    prisma.bill.groupBy({ by: ["customerId", "customerName"], where: billWhere, _count: true, _sum: { grandTotal: true } }),
  ]);

  const gross = sum(bills._sum.grandTotal);
  const credited = sum(credits._sum.grandTotal);
  return {
    from, to,
    billCount: bills._count,
    taxable: sum(bills._sum.taxableTotal), cgst: sum(bills._sum.cgstTotal), sgst: sum(bills._sum.sgstTotal), igst: sum(bills._sum.igstTotal),
    roundOff: sum(bills._sum.roundOff), billed: gross,
    creditNoteCount: credits._count, credited, netSales: gross.minus(credited),
    byDay: byDay.map((d) => ({ day: d.day, bills: d.bills, total: D(d.total) })),
    byProduct: byProduct
      .map((p) => ({ productId: p.productId, name: p.productName, quantity: sum(p._sum.quantity), taxable: sum(p._sum.taxableValue), total: sum(p._sum.lineTotal) }))
      .sort((a, b) => b.total.comparedTo(a.total)).slice(0, 50),
    byCustomer: byCustomer
      .map((c) => ({ customerId: c.customerId, name: c.customerName, bills: c._count, total: sum(c._sum.grandTotal) }))
      .sort((a, b) => b.total.comparedTo(a.total)).slice(0, 50),
  };
}

// ── Money owed, by age ───────────────────────────────────────────────────────────────────────────────────────

export const AGEING_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
type Bucket = (typeof AGEING_BUCKETS)[number];

export function ageBucket(days: number): Bucket {
  return days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
}

export async function getDuesAgeing(session: Session | null) {
  requireRole(session, ["OWNER"]);
  const outstanding = await listOutstandingBills(prisma);
  const today = Date.parse(`${istToday()}T00:00:00Z`);
  const empty = (): Record<Bucket, Money> => ({ "0-30": ZERO, "31-60": ZERO, "61-90": ZERO, "90+": ZERO });
  const totals = empty();
  const byCustomer = new Map<string, { customerId: string; name: string; buckets: Record<Bucket, Money>; total: Money }>();

  for (const bill of outstanding) {
    const billDay = Date.parse(`${istToday(bill.billDate)}T00:00:00Z`);
    const bucket = ageBucket(Math.max(0, Math.round((today - billDay) / 86_400_000)));
    const row = byCustomer.get(bill.customerId) ?? { customerId: bill.customerId, name: bill.customerName, buckets: empty(), total: ZERO };
    row.buckets[bucket] = row.buckets[bucket].plus(bill.amountDue);
    row.total = row.total.plus(bill.amountDue);
    totals[bucket] = totals[bucket].plus(bill.amountDue);
    byCustomer.set(bill.customerId, row);
  }
  return {
    totals, grandTotal: sumDecimals(Object.values(totals)),
    customers: [...byCustomer.values()].sort((a, b) => b.total.comparedTo(a.total)),
  };
}

// ── Stock movement ───────────────────────────────────────────────────────────────────────────────────────────

export async function getStockMovementReport(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { from, to, start, end } = parseRange(rawInput);
  const rows = await prisma.$queryRaw<{ id: string; name: string; qtyPerCarton: number; opening: string; produced: string; billed: string; returned: string; adjusted: string; closing: string }[]>(Prisma.sql`
    SELECT p.id, p.name, p."qtyPerCarton",
      COALESCE(SUM(l."quantityDelta") FILTER (WHERE l."createdAt" < ${start}), 0)::text AS opening,
      COALESCE(SUM(l."quantityDelta") FILTER (WHERE l."createdAt" >= ${start} AND l."createdAt" < ${end} AND l.type IN ('PRODUCED', 'OPENING')), 0)::text AS produced,
      COALESCE(SUM(l."quantityDelta") FILTER (WHERE l."createdAt" >= ${start} AND l."createdAt" < ${end} AND l.type = 'BILLED'), 0)::text AS billed,
      COALESCE(SUM(l."quantityDelta") FILTER (WHERE l."createdAt" >= ${start} AND l."createdAt" < ${end} AND l.type = 'RETURN'), 0)::text AS returned,
      COALESCE(SUM(l."quantityDelta") FILTER (WHERE l."createdAt" >= ${start} AND l."createdAt" < ${end} AND l.type = 'ADJUSTMENT'), 0)::text AS adjusted,
      COALESCE(SUM(l."quantityDelta") FILTER (WHERE l."createdAt" < ${end}), 0)::text AS closing
    FROM products p LEFT JOIN stock_ledger l ON l."productId" = p.id
    WHERE p."isActive" = true
    GROUP BY p.id, p.name, p."qtyPerCarton" ORDER BY p.name`);
  return {
    from, to,
    items: rows.map((r) => ({
      id: r.id, name: r.name, qtyPerCarton: r.qtyPerCarton, opening: D(r.opening), produced: D(r.produced),
      sold: D(r.billed).negated(), returned: D(r.returned), adjusted: D(r.adjusted), closing: D(r.closing),
    })),
  };
}

// ── GST exports ──────────────────────────────────────────────────────────────────────────────────────────────

/** A spreadsheet opens "=cmd..." or "+1+1" as a formula; text cells starting that way get a leading apostrophe. */
function safeCell(value: string): string {
  if (/^-?\d+(\.\d+)?$/.test(value)) return value; // a plain number (including a negative one) is not a formula
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function toCsv(rows: (string | number)[][]): string {
  return Papa.unparse(rows.map((row) => row.map((cell) => (typeof cell === "string" ? safeCell(cell) : cell))), { newline: "\r\n" });
}

const money2 = (v: Money) => toFixed2(v);

/** Every invoice and credit note in the range, one row each (credit notes show as negative amounts). */
export async function salesRegisterCsv(session: Session | null, rawInput: unknown): Promise<string> {
  requireRole(session, ["OWNER"]);
  const { start, end } = parseRange(rawInput);
  const [bills, notes] = await Promise.all([
    prisma.bill.findMany({ where: { billDate: { gte: start, lt: end } }, orderBy: { billDate: "asc" } }),
    prisma.creditNote.findMany({ where: { noteDate: { gte: start, lt: end } }, orderBy: { noteDate: "asc" }, include: { bill: true } }),
  ]);
  const rows: (string | number)[][] = [[
    "Type", "Number", "Date", "Customer", "Customer GSTIN", "Place of supply", "Original invoice", "Taxable value", "CGST", "SGST", "IGST", "Round off", "Total",
  ]];
  for (const b of bills) {
    rows.push(["Invoice", b.invoiceNumber, formatDateIN(b.billDate), b.customerName, b.customerGstin ?? "", `${stateName(b.placeOfSupply)} (${b.placeOfSupply})`, "",
      money2(D(b.taxableTotal)), money2(D(b.cgstTotal)), money2(D(b.sgstTotal)), money2(D(b.igstTotal)), money2(D(b.roundOff)), money2(D(b.grandTotal))]);
  }
  for (const n of notes) {
    const neg = (v: Prisma.Decimal) => money2(D(v).negated());
    rows.push(["Credit note", n.creditNoteNumber, formatDateIN(n.noteDate), n.bill.customerName, n.bill.customerGstin ?? "", `${stateName(n.bill.placeOfSupply)} (${n.bill.placeOfSupply})`, n.bill.invoiceNumber,
      neg(n.taxableTotal), neg(n.cgstTotal), neg(n.sgstTotal), neg(n.igstTotal), neg(n.roundOff), neg(n.grandTotal)]);
  }
  return toCsv(rows);
}

/** HSN-wise summary for GST returns: invoices add, credit notes subtract, extra charges are listed on their own line. */
export async function hsnSummaryCsv(session: Session | null, rawInput: unknown): Promise<string> {
  requireRole(session, ["OWNER"]);
  const { start, end } = parseRange(rawInput);
  const [lines, charges, noteLines] = await Promise.all([
    prisma.billLineItem.groupBy({
      by: ["hsnCode", "gstRate", "unit"], where: { bill: { billDate: { gte: start, lt: end } } },
      _sum: { quantity: true, taxableValue: true, cgstAmount: true, sgstAmount: true, igstAmount: true },
    }),
    prisma.billCharge.groupBy({
      by: ["gstRate"], where: { bill: { billDate: { gte: start, lt: end } } },
      _sum: { taxableValue: true, cgstAmount: true, sgstAmount: true, igstAmount: true },
    }),
    prisma.creditNoteLine.findMany({
      where: { creditNote: { noteDate: { gte: start, lt: end } } },
      select: { quantity: true, taxableValue: true, cgstAmount: true, sgstAmount: true, igstAmount: true, billLineItem: { select: { hsnCode: true, gstRate: true, unit: true } } },
    }),
  ]);

  type Row = { hsn: string; rate: string; unit: string; qty: Money; taxable: Money; cgst: Money; sgst: Money; igst: Money };
  const table = new Map<string, Row>();
  const add = (hsn: string, rate: Money, unit: string, sign: 1 | -1, v: { qty: Money; taxable: Money; cgst: Money; sgst: Money; igst: Money }) => {
    const key = `${hsn}|${rate.toFixed(2)}|${unit}`;
    const row = table.get(key) ?? { hsn, rate: rate.toFixed(2), unit, qty: ZERO, taxable: ZERO, cgst: ZERO, sgst: ZERO, igst: ZERO };
    const s = D(sign);
    row.qty = row.qty.plus(v.qty.times(s)); row.taxable = row.taxable.plus(v.taxable.times(s));
    row.cgst = row.cgst.plus(v.cgst.times(s)); row.sgst = row.sgst.plus(v.sgst.times(s)); row.igst = row.igst.plus(v.igst.times(s));
    table.set(key, row);
  };
  for (const l of lines) add(l.hsnCode, D(l.gstRate), l.unit, 1, { qty: sum(l._sum.quantity), taxable: sum(l._sum.taxableValue), cgst: sum(l._sum.cgstAmount), sgst: sum(l._sum.sgstAmount), igst: sum(l._sum.igstAmount) });
  for (const c of charges) add("CHARGES", D(c.gstRate), "-", 1, { qty: ZERO, taxable: sum(c._sum.taxableValue), cgst: sum(c._sum.cgstAmount), sgst: sum(c._sum.sgstAmount), igst: sum(c._sum.igstAmount) });
  for (const n of noteLines) add(n.billLineItem.hsnCode, D(n.billLineItem.gstRate), n.billLineItem.unit, -1, { qty: D(n.quantity), taxable: D(n.taxableValue), cgst: D(n.cgstAmount), sgst: D(n.sgstAmount), igst: D(n.igstAmount) });

  const rows: (string | number)[][] = [["HSN", "GST rate %", "Unit", "Quantity", "Taxable value", "CGST", "SGST", "IGST", "Total tax"]];
  for (const r of [...table.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || Number(a.rate) - Number(b.rate))) {
    rows.push([r.hsn, r.rate, r.unit, r.qty.toString(), money2(r.taxable), money2(r.cgst), money2(r.sgst), money2(r.igst), money2(r.cgst.plus(r.sgst).plus(r.igst))]);
  }
  if (rows.length === 1) throw new ValidationError("There are no sales in this date range.");
  return toCsv(rows);
}
