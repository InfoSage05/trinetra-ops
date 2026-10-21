import Decimal from "decimal.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { D, ZERO, toFixed2 } from "@/lib/money";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { istDateParts } from "@/lib/time";
import { entityId, idempotencyKey, nonNegativeQuantity, optionalText, parseInput, quantity } from "@/lib/validation";
import { getStockLevels } from "@/domain/stock";

/**
 * Customer orders that are still to be made and delivered. Lines never change once saved (cancel and re-enter
 * instead). What has been delivered is not stored: it is the quantity on bills raised against the order, so the
 * numbers can never disagree with the invoices.
 */

const dateOnly = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date the order is needed by.").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Choose a real date.");

export const orderLineSchema = z
  .object({ productId: entityId, quantity: quantity.optional(), cartons: nonNegativeQuantity.optional(), loosePieces: nonNegativeQuantity.optional() })
  .superRefine((line, ctx) => {
    const hasPieces = line.quantity !== undefined;
    const hasCartons = line.cartons !== undefined || line.loosePieces !== undefined;
    if (hasPieces && hasCartons) ctx.addIssue({ code: "custom", message: "Enter either cartons or a quantity in pieces, not both.", path: ["quantity"] });
    if (!hasPieces && !hasCartons) ctx.addIssue({ code: "custom", message: "Enter the number of cartons.", path: ["cartons"] });
  });

export const createOrderSchema = z.object({
  customerId: entityId,
  dueDate: dateOnly,
  notes: optionalText(500),
  lines: z.array(orderLineSchema).min(1, "Add at least one item.").max(100),
  source: z.enum(["MANUAL", "TEXT", "VOICE"]).default("MANUAL"),
  sourceText: optionalText(4000),
  sourceMetadata: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey,
});

const orderInclude = { lines: { orderBy: { lineNo: "asc" as const } }, customer: { select: { id: true, name: true, phone: true } } };

export async function createOrder(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(createOrderSchema, rawInput);
  const key = `order:${input.idempotencyKey}`;
  const existing = await prisma.order.findUnique({ where: { idempotencyKey: key }, include: orderInclude });
  if (existing) return existing;

  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw new NotFoundError("Customer");
  if (!customer.isActive) throw new DomainError("CUSTOMER_INACTIVE", `${customer.name} is marked inactive.`);
  const products = await prisma.product.findMany({ where: { id: { in: [...new Set(input.lines.map((l) => l.productId))] } } });
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines = input.lines.map((line, index) => {
    const product = byId.get(line.productId);
    if (!product) throw new NotFoundError(`Item on line ${index + 1}`);
    if (!product.isActive) throw new DomainError("PRODUCT_INACTIVE", `${product.name} is marked inactive.`);
    const pieces = line.quantity !== undefined
      ? D(line.quantity)
      : D(line.cartons ?? 0).times(product.qtyPerCarton).plus(D(line.loosePieces ?? 0));
    if (!pieces.greaterThan(0)) throw new ValidationError(`Line ${index + 1} (${product.name}): enter at least 1 carton or piece.`);
    return { lineNo: index + 1, productId: product.id, quantity: toFixed2(pieces) };
  });

  const { year, month, day } = istDateParts(new Date());
  const today = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (input.dueDate < today) throw new ValidationError("The needed-by date is in the past.", { dueDate: ["Choose today or a later date."] });

  try {
    return await prisma.order.create({
      data: {
        customerId: customer.id, dueDate: new Date(`${input.dueDate}T00:00:00Z`), notes: input.notes ?? null,
        source: input.source, sourceText: input.sourceText ?? null,
        sourceMetadata: (input.sourceMetadata ?? undefined) as Prisma.InputJsonValue | undefined,
        actorType: input.source === "MANUAL" ? "HUMAN" : "AGENT",
        createdBy: session.userId, idempotencyKey: key,
        lines: { create: lines },
      },
      include: orderInclude,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const winner = await prisma.order.findUnique({ where: { idempotencyKey: key }, include: orderInclude });
      if (winner) return winner;
    }
    throw error;
  }
}

async function requireOpenOrder(id: string) {
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) throw new NotFoundError("Order");
  if (order.cancelledAt) throw new DomainError("ORDER_NOT_OPEN", "This order is already cancelled.");
  if (order.closedAt) throw new DomainError("ORDER_NOT_OPEN", "This order is already closed.");
  return order;
}

export async function cancelOrder(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { orderId } = parseInput(z.object({ orderId: entityId }), rawInput);
  await requireOpenOrder(orderId);
  return prisma.order.update({ where: { id: orderId }, data: { cancelledAt: new Date() } });
}

/** Marks an order finished even though some quantity was never delivered (customer settled for less). */
export async function closeOrder(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { orderId } = parseInput(z.object({ orderId: entityId }), rawInput);
  await requireOpenOrder(orderId);
  return prisma.order.update({ where: { id: orderId }, data: { closedAt: new Date() } });
}

// ── Reading orders ──────────────────────────────────────────────────────────────────────────────────────────

export type OrderStatus = "PENDING" | "PARTIAL" | "COMPLETED" | "CANCELLED" | "CLOSED";
export type DueState = "OVERDUE" | "DUE_SOON" | "LATER";

export type OrderLineView = {
  productId: string; productName: string; unit: string; qtyPerCarton: number;
  ordered: Decimal; delivered: Decimal; outstanding: Decimal; stock: Decimal;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function dueStateOf(dueDate: Date, now: Date): DueState {
  const { year, month, day } = istDateParts(now);
  const days = Math.round((dueDate.getTime() - Date.UTC(year, month - 1, day)) / DAY_MS);
  return days < 0 ? "OVERDUE" : days <= 2 ? "DUE_SOON" : "LATER";
}

export function daysUntil(dueDate: Date, now: Date = new Date()): number {
  const { year, month, day } = istDateParts(now);
  return Math.round((dueDate.getTime() - Date.UTC(year, month - 1, day)) / DAY_MS);
}

type OrderWithLines = Prisma.OrderGetPayload<{ include: { lines: { include: { product: true } }; customer: { select: { id: true; name: true; phone: true } } } }>;

async function describeOrders(orders: OrderWithLines[], now: Date) {
  const orderIds = orders.map((o) => o.id);
  const delivered = await prisma.billLineItem.groupBy({
    by: ["productId", "billId"], where: { bill: { orderId: { in: orderIds } } }, _sum: { quantity: true },
  });
  const bills = await prisma.bill.findMany({ where: { orderId: { in: orderIds } }, select: { id: true, orderId: true, invoiceNumber: true } });
  const billOrder = new Map(bills.map((b) => [b.id, b.orderId!]));
  const deliveredBy = new Map<string, Decimal>();
  for (const row of delivered) {
    const key = `${billOrder.get(row.billId)}:${row.productId}`;
    deliveredBy.set(key, (deliveredBy.get(key) ?? ZERO).plus(D(row._sum.quantity ?? 0)));
  }
  const stock = await getStockLevels(prisma, [...new Set(orders.flatMap((o) => o.lines.map((l) => l.productId)))]);

  return orders.map((order) => {
    const lines: OrderLineView[] = order.lines.map((l) => {
      const ordered = D(l.quantity);
      const done = deliveredBy.get(`${order.id}:${l.productId}`) ?? ZERO;
      return {
        productId: l.productId, productName: l.product.name, unit: l.product.unit, qtyPerCarton: l.product.qtyPerCarton,
        ordered, delivered: done, outstanding: Decimal.max(ordered.minus(done), ZERO), stock: stock.get(l.productId) ?? ZERO,
      };
    });
    const anyDelivered = lines.some((l) => l.delivered.greaterThan(0));
    const allDone = lines.every((l) => l.outstanding.isZero());
    const status: OrderStatus = order.cancelledAt ? "CANCELLED" : order.closedAt ? "CLOSED" : allDone ? "COMPLETED" : anyDelivered ? "PARTIAL" : "PENDING";
    const open = status === "PENDING" || status === "PARTIAL";
    return {
      id: order.id, customer: order.customer, dueDate: order.dueDate, notes: order.notes, source: order.source, sourceText: order.sourceText,
      createdAt: order.createdAt, status, open, dueState: open ? dueStateOf(order.dueDate, now) : null, lines,
      bills: bills.filter((b) => b.orderId === order.id).map((b) => ({ id: b.id, invoiceNumber: b.invoiceNumber })),
    };
  });
}

const withProducts = { lines: { orderBy: { lineNo: "asc" as const }, include: { product: true } }, customer: { select: { id: true, name: true, phone: true } } };

export async function listOrders(session: Session | null, rawInput: unknown = {}) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(z.object({ show: z.enum(["OPEN", "ALL"]).default("OPEN"), customerId: entityId.optional(), take: z.number().int().min(1).max(500).default(200) }), rawInput);
  const orders = await prisma.order.findMany({
    where: { ...(input.customerId ? { customerId: input.customerId } : {}), ...(input.show === "OPEN" ? { cancelledAt: null, closedAt: null } : {}) },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }], take: input.show === "OPEN" ? undefined : input.take, include: withProducts,
  });
  const described = await describeOrders(orders, new Date());
  return input.show === "OPEN" ? described.filter((o) => o.open) : described;
}

export async function getOrder(session: Session | null, id: string) {
  requireRole(session, ["OWNER"]);
  const order = await prisma.order.findUnique({ where: { id }, include: withProducts });
  if (!order) throw new NotFoundError("Order");
  return (await describeOrders([order], new Date()))[0];
}

/** What still has to be made: outstanding quantity across all open orders, against what is in stock now. */
export async function getPendingRequirements(session: Session | null) {
  const orders = await listOrders(session, { show: "OPEN" });
  const totals = new Map<string, { productId: string; productName: string; unit: string; qtyPerCarton: number; outstanding: Decimal; stock: Decimal; orders: number }>();
  for (const order of orders) {
    for (const l of order.lines) {
      if (l.outstanding.isZero()) continue;
      const row = totals.get(l.productId) ?? { productId: l.productId, productName: l.productName, unit: l.unit, qtyPerCarton: l.qtyPerCarton, outstanding: ZERO, stock: l.stock, orders: 0 };
      row.outstanding = row.outstanding.plus(l.outstanding);
      row.orders += 1;
      totals.set(l.productId, row);
    }
  }
  return [...totals.values()]
    .map((r) => ({ ...r, toMake: Decimal.max(r.outstanding.minus(Decimal.max(r.stock, ZERO)), ZERO) }))
    .sort((a, b) => b.toMake.comparedTo(a.toMake) || a.productName.localeCompare(b.productName));
}

/** Orders needing attention for the dashboard: overdue or due within two days. */
export async function getOrderReminders(session: Session | null) {
  const orders = await listOrders(session, { show: "OPEN" });
  return orders.filter((o) => o.dueState === "OVERDUE" || o.dueState === "DUE_SOON");
}
