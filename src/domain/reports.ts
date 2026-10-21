import Decimal from "decimal.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { D, ZERO, sumDecimals } from "@/lib/money";
import { istDayRange } from "@/lib/time";
import { parseInput } from "@/lib/validation";
import { NotFoundError } from "@/lib/errors";
import { getCurrentStock, getStockLevels } from "@/domain/stock";
import { getPaymentSummaries, type PaymentStatus } from "@/domain/payments";

export type StockStatus = "NEGATIVE" | "LOW" | "OK";

export async function getStockOverview(session: Session | null, rawInput: unknown = {}) {
  requireRole(session, ["OWNER", "WORKER"]);
  const { search } = parseInput(z.object({ search: z.string().trim().optional() }), rawInput);
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { sku: { contains: search, mode: "insensitive" } }] } : {}),
    },
    select: { id: true, sku: true, name: true, unit: true, qtyPerCarton: true, reorderLevel: true },
    orderBy: { name: "asc" },
  });
  const levels = await getStockLevels(prisma, products.map((p) => p.id));
  return products.map((p) => {
    const stock = levels.get(p.id) ?? ZERO;
    const status: StockStatus = stock.isNegative() ? "NEGATIVE" : stock.lessThanOrEqualTo(D(p.reorderLevel)) && D(p.reorderLevel).greaterThan(0) ? "LOW" : "OK";
    return { id: p.id, sku: p.sku, name: p.name, unit: p.unit, qtyPerCarton: p.qtyPerCarton, stock, reorderLevel: D(p.reorderLevel), status };
  });
}

export async function listPendingStockCounts(session: Session | null) {
  requireRole(session, ["OWNER"]);
  const counts = await prisma.stockCount.findMany({
    where: { approvedAt: null, discardedAt: null },
    include: { product: { select: { name: true, sku: true } } },
    orderBy: { countedAt: "asc" },
  });
  return Promise.all(counts.map(async (c) => ({
    id: c.id, productId: c.productId, productName: c.product.name, sku: c.product.sku,
    countedQuantity: c.countedQuantity, expectedQuantity: c.expectedQuantity,
    delta: D(c.countedQuantity).minus(D(c.expectedQuantity)), countedBy: c.countedBy, countedAt: c.countedAt, note: c.note,
    movementsSinceCount: await prisma.stockLedgerEntry.count({ where: { productId: c.productId, createdAt: { gt: c.countedAt } } }),
  })));
}

export async function getOwnerDashboard(session: Session | null) {
  requireRole(session, ["OWNER"]);
  const { start, end } = istDayRange();
  const [todayBills, allBills, stock, irpIssues, pendingCounts] = await Promise.all([
    prisma.bill.findMany({ where: { billDate: { gte: start, lt: end } }, select: { grandTotal: true } }),
    prisma.bill.findMany({ select: { id: true, customerId: true, customerName: true } }),
    getStockOverview(session, {}),
    prisma.irpSubmission.findMany({
      where: { OR: [{ status: { in: ["FAILED", "REJECTED"] } }, { status: "PENDING", createdAt: { lt: new Date(Date.now() - 60 * 60_000) } }] },
      include: { bill: { select: { invoiceNumber: true } }, creditNote: { select: { creditNoteNumber: true } } },
      orderBy: { createdAt: "asc" },
    }),
    listPendingStockCounts(session),
  ]);

  const summaries = await getPaymentSummaries(prisma, allBills.map((b) => b.id));
  const dueByCustomer = new Map<string, { customerId: string; customerName: string; amountDue: Decimal }>();
  for (const b of allBills) {
    const due = summaries.get(b.id)?.amountDue ?? ZERO;
    if (due.lessThanOrEqualTo(0)) continue;
    const entry = dueByCustomer.get(b.customerId) ?? { customerId: b.customerId, customerName: b.customerName, amountDue: ZERO };
    entry.amountDue = entry.amountDue.plus(due);
    dueByCustomer.set(b.customerId, entry);
  }
  const dues = [...dueByCustomer.values()].sort((a, b) => b.amountDue.comparedTo(a.amountDue));

  return {
    today: { billCount: todayBills.length, salesTotal: sumDecimals(todayBills.map((b) => b.grandTotal)) },
    totalDue: sumDecimals(dues.map((d) => d.amountDue)),
    topDues: dues.slice(0, 10),
    negativeStock: stock.filter((s) => s.status === "NEGATIVE"),
    lowStock: stock.filter((s) => s.status === "LOW"),
    irpIssues: irpIssues.map((j) => ({
      id: j.id, status: j.status, lastError: j.lastError, attemptCount: j.attemptCount,
      documentNumber: j.bill?.invoiceNumber ?? j.creditNote?.creditNoteNumber ?? "",
      billId: j.billId,
    })),
    pendingCounts,
  };
}

export async function listBills(session: Session | null, rawInput: unknown = {}) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(
    z.object({
      search: z.string().trim().optional(),
      status: z.enum(["PAID", "PARTIAL", "UNPAID", "DUE"]).optional(),
      take: z.number().int().min(1).max(500).default(100),
    }),
    rawInput
  );
  const bills = await prisma.bill.findMany({
    where: input.search
      ? { OR: [{ invoiceNumber: { contains: input.search, mode: "insensitive" } }, { customerName: { contains: input.search, mode: "insensitive" } }] }
      : {},
    orderBy: { billDate: "desc" },
    // A status filter depends on payments, so it must see every match before the limit is applied.
    ...(input.status ? {} : { take: input.take }),
    select: { id: true, invoiceNumber: true, billDate: true, customerName: true, grandTotal: true },
  });
  const summaries = await getPaymentSummaries(prisma, bills.map((b) => b.id));
  const matches = (status: PaymentStatus) =>
    !input.status || (input.status === "DUE" ? status !== "PAID" : status === input.status);
  return bills
    .map((b) => ({ ...b, payment: summaries.get(b.id)! }))
    .filter((b) => matches(b.payment.status))
    .slice(0, input.take);
}

/** One item: stock now, and its recent stock movements (what came in, what went out and why). Workers see no money. */
export async function getProductDetail(session: Session | null, id: string) {
  requireRole(session, ["OWNER", "WORKER"]);
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) throw new NotFoundError("Item");
  const [stock, movements, soldAgg] = await Promise.all([
    getCurrentStock(prisma, id),
    prisma.stockLedgerEntry.findMany({ where: { productId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    session?.role === "OWNER"
      ? prisma.billLineItem.findMany({ where: { productId: id }, orderBy: { bill: { billDate: "desc" } }, take: 10, select: { quantity: true, bill: { select: { id: true, invoiceNumber: true, billDate: true, customerName: true } } } })
      : Promise.resolve([]),
  ]);
  const reorderLevel = D(product.reorderLevel);
  const status: StockStatus = stock.isNegative() ? "NEGATIVE" : reorderLevel.greaterThan(0) && stock.lessThanOrEqualTo(reorderLevel) ? "LOW" : "OK";
  return {
    id: product.id, sku: product.sku, name: product.name, unit: product.unit, qtyPerCarton: product.qtyPerCarton,
    reorderLevel, stock, status,
    unitPrice: session?.role === "OWNER" ? product.unitPrice : null,
    movements: movements.map((m) => ({ id: m.id, type: m.type, quantityDelta: m.quantityDelta, reason: m.reason, actorType: m.actorType, createdAt: m.createdAt })),
    recentSales: soldAgg.map((s) => ({ billId: s.bill.id, invoiceNumber: s.bill.invoiceNumber, billDate: s.bill.billDate, customerName: s.bill.customerName, quantity: s.quantity })),
  };
}

/** One customer: details, what they have been billed and what they still owe. */
export async function getCustomerDetail(session: Session | null, id: string) {
  requireRole(session, ["OWNER"]);
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) throw new NotFoundError("Customer");
  const bills = await prisma.bill.findMany({
    where: { customerId: id }, orderBy: { billDate: "desc" },
    select: { id: true, invoiceNumber: true, billDate: true, grandTotal: true },
  });
  const summaries = await getPaymentSummaries(prisma, bills.map((b) => b.id));
  const rows = bills.map((b) => ({ ...b, payment: summaries.get(b.id)! }));
  return {
    customer,
    bills: rows,
    billedTotal: sumDecimals(rows.map((b) => b.grandTotal)),
    totalDue: sumDecimals(rows.map((b) => b.payment.amountDue.greaterThan(0) ? b.payment.amountDue : ZERO)),
  };
}
