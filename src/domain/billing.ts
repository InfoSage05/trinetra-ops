import Decimal from "decimal.js";
import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import type { Bill, BillLineItem } from "@/generated/prisma/client";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { stateName } from "@/lib/gst";
import { D, ZERO, toFixed2 } from "@/lib/money";
import { MAX_BILL_ITEMS } from "@/lib/limits";
import { RATE_TIERS, rateFor, type RateTier } from "@/lib/rates";
import { financialYearOf } from "@/lib/time";
import {
  entityId, gstRate, idempotencyKey, money, nonNegativeQuantity, optionalText, parseInput, positiveMoney, quantity, stateCode,
} from "@/lib/validation";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { computeLine, computeTotals, isInterState, taxOnTaxableValue, type DocumentTotals, type LineAmounts, type TaxSplit } from "@/domain/tax";
import { getStockLevels, writeLedgerEntry } from "@/domain/stock";
import { allocateNumber } from "@/domain/numbering";
import { requireBusinessProfile } from "@/domain/settings";

export const PAYMENT_METHODS = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"] as const;

export const CHARGE_KINDS = ["CARTON", "CRATE", "FREIGHT", "OTHER"] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];
export const CHARGE_LABELS: Record<ChargeKind, string> = {
  CARTON: "Carton charges", CRATE: "Extra crate charges", FREIGHT: "Freight charges", OTHER: "Other charges",
};

/**
 * A line is entered either as a plain `quantity` in pieces, or as `cartons` (+ optional `loosePieces`).
 * Each product has its own pieces-per-carton, so cartons are resolved against the product in computeBill.
 */
export const billLineSchema = z
  .object({
    productId: entityId,
    quantity: quantity.optional(),
    cartons: nonNegativeQuantity.optional(),
    loosePieces: nonNegativeQuantity.optional(),
    unitPrice: money.optional(),
    /** Use this one rate of the item (A, B or C) for just this line, instead of the bill's rate type. */
    rateTier: z.enum(RATE_TIERS).optional(),
    discountAmount: money.optional(),
  })
  .superRefine((line, ctx) => {
    const hasPieces = line.quantity !== undefined;
    const hasCartons = line.cartons !== undefined || line.loosePieces !== undefined;
    if (hasPieces && hasCartons) ctx.addIssue({ code: "custom", message: "Enter either cartons or a quantity in pieces, not both.", path: ["quantity"] });
    if (!hasPieces && !hasCartons) ctx.addIssue({ code: "custom", message: "Enter the number of cartons.", path: ["cartons"] });
  });

export const billChargeSchema = z.object({
  kind: z.enum(CHARGE_KINDS),
  label: optionalText(60),
  amount: positiveMoney,
  gstRate: gstRate.optional(),
});

export const billDraftSchema = z.object({
  customerId: entityId,
  placeOfSupply: stateCode,
  deliveryAddress: optionalText(300),
  notes: optionalText(500),
  /** Which of the three rates this bill uses; if left out, the customer's own rate type is used. */
  rateTier: z.enum(RATE_TIERS).optional(),
  lines: z.array(billLineSchema).min(1, "Add at least one item.").max(MAX_BILL_ITEMS, `A bill can have at most ${MAX_BILL_ITEMS} items. Make a second bill for the rest.`),
  charges: z
    .array(billChargeSchema)
    .max(10)
    .default([])
    .refine(
      (charges) => {
        const kinds = charges.filter((c) => c.kind !== "OTHER").map((c) => c.kind);
        return new Set(kinds).size === kinds.length;
      },
      "Each of carton, crate and freight charges can appear only once."
    ),
});

export type BillDraft = z.output<typeof billDraftSchema>;

export type PreviewLine = LineAmounts & {
  productId: string; productName: string; productSku: string | null; hsnCode: string; unit: string;
  quantity: Decimal; qtyPerCarton: number; cartons: Decimal; unitPrice: Decimal; gstRate: Decimal;
  availableBefore: Decimal; shortfallQuantity: Decimal | null;
};

export type PreviewCharge = TaxSplit & {
  chargeNo: number; kind: ChargeKind; label: string; taxableValue: Decimal; gstRate: Decimal; lineTotal: Decimal;
};

export type BillPreview = DocumentTotals & {
  customerId: string; customerName: string; placeOfSupply: string; placeOfSupplyName: string;
  interState: boolean; rateTier: RateTier; hasShortfall: boolean; lines: PreviewLine[]; charges: PreviewCharge[];
};

/** Shared by previewBill and createBill: always computed from current database state. */
export async function computeBill(db: Db, draft: BillDraft) {
  const profile = await requireBusinessProfile(db);
  const customer = await db.customer.findUnique({ where: { id: draft.customerId } });
  if (!customer) throw new NotFoundError("Customer");
  if (!customer.isActive) throw new DomainError("CUSTOMER_INACTIVE", `${customer.name} is marked inactive.`);

  const productIds = [...new Set(draft.lines.map((l) => l.productId))];
  const products = new Map((await db.product.findMany({ where: { id: { in: productIds } } })).map((p) => [p.id, p]));
  const remaining = await getStockLevels(db, productIds);
  const interState = isInterState(profile.stateCode, draft.placeOfSupply);
  const rateTier: RateTier = draft.rateTier ?? customer.rateTier;

  const lines: PreviewLine[] = draft.lines.map((line, index) => {
    const product = products.get(line.productId);
    if (!product) throw new NotFoundError(`Product on line ${index + 1}`);
    if (!product.isActive) throw new DomainError("PRODUCT_INACTIVE", `${product.name} is marked inactive.`);

    const qtyPerCarton = product.qtyPerCarton;
    const qty = line.quantity !== undefined
      ? D(line.quantity)
      : D(line.cartons ?? 0).times(qtyPerCarton).plus(D(line.loosePieces ?? 0));
    if (!qty.greaterThan(0)) throw new ValidationError(`Line ${index + 1} (${product.name}): enter at least 1 carton or piece.`);

    const unitPrice = line.unitPrice !== undefined ? D(line.unitPrice) : rateFor(product, line.rateTier ?? rateTier);
    let amounts: LineAmounts;
    try {
      amounts = computeLine({ quantity: qty, unitPrice, discountAmount: line.discountAmount, gstRate: product.gstRate }, interState);
    } catch (error) {
      if (error instanceof ValidationError) throw new ValidationError(`Line ${index + 1} (${product.name}): ${error.message}`);
      throw error;
    }

    const availableBefore = remaining.get(product.id) ?? ZERO;
    const usable = Decimal.max(availableBefore, ZERO);
    remaining.set(product.id, availableBefore.minus(qty));

    return {
      ...amounts,
      productId: product.id, productName: product.name, productSku: product.sku, hsnCode: product.hsnCode, unit: product.unit,
      quantity: qty, qtyPerCarton, cartons: qty.div(qtyPerCarton).toDecimalPlaces(2), unitPrice, gstRate: D(product.gstRate),
      availableBefore, shortfallQuantity: qty.greaterThan(usable) ? qty.minus(usable) : null,
    };
  });

  // Packing/freight on a composite supply follow the principal supply, so by default they take the highest item rate.
  const defaultChargeRate = lines.reduce((max, l) => Decimal.max(max, l.gstRate), ZERO);
  const charges: PreviewCharge[] = draft.charges.map((c, i) => {
    const taxableValue = D(c.amount);
    const rate = D(c.gstRate ?? defaultChargeRate);
    const tax = taxOnTaxableValue(taxableValue, rate, interState);
    return {
      chargeNo: i + 1, kind: c.kind, label: c.label ?? CHARGE_LABELS[c.kind], taxableValue, gstRate: rate, ...tax,
      lineTotal: taxableValue.plus(tax.cgstAmount).plus(tax.sgstAmount).plus(tax.igstAmount),
    };
  });

  const preview: BillPreview = {
    ...computeTotals([...lines, ...charges.map((c) => ({ ...c, grossAmount: c.taxableValue, discountAmount: ZERO }))]),
    customerId: customer.id, customerName: customer.name,
    placeOfSupply: draft.placeOfSupply, placeOfSupplyName: stateName(draft.placeOfSupply),
    interState, rateTier, hasShortfall: lines.some((l) => l.shortfallQuantity !== null), lines, charges,
  };
  return { preview, profile, customer };
}

export async function previewBill(session: Session | null, rawInput: unknown): Promise<BillPreview> {
  requireRole(session, ["OWNER"]);
  return (await computeBill(prisma, parseInput(billDraftSchema, rawInput))).preview;
}

export const createBillSchema = billDraftSchema.extend({
  idempotencyKey,
  /** Raised against a customer's pending order; the order's delivered quantity is worked out from its bills. */
  orderId: entityId.optional(),
  confirmShortfall: z.boolean().default(false),
  initialPayment: z.object({ amount: positiveMoney, method: z.enum(PAYMENT_METHODS), reference: optionalText(100) }).optional(),
});

export type CreatedBill = Bill & { lineItems: BillLineItem[] };
const withLines = { lineItems: { orderBy: { lineNo: "asc" as const } } };

function describeShortfall(preview: BillPreview): string {
  const items = preview.lines
    .filter((l) => l.shortfallQuantity)
    .map((l) => `${l.productName} (short by ${l.shortfallQuantity!.toString()})`)
    .join(", ");
  return `Not enough stock: ${items}. Confirm to bill anyway; the shortfall will be recorded as still owed.`;
}

export async function createBill(session: Session | null, rawInput: unknown): Promise<CreatedBill> {
  requireRole(session, ["OWNER"]);
  const input = parseInput(createBillSchema, rawInput);
  const key = `bill:${input.idempotencyKey}`;

  const existing = await prisma.bill.findUnique({ where: { idempotencyKey: key }, include: withLines });
  if (existing) return existing;

  try {
    return await prisma.$transaction(async (tx) => {
      const { preview, profile, customer } = await computeBill(tx, input);
      if (preview.hasShortfall && !input.confirmShortfall) {
        throw new DomainError("SHORTFALL_NOT_CONFIRMED", describeShortfall(preview));
      }
      if (input.initialPayment && D(input.initialPayment.amount).greaterThan(preview.grandTotal)) {
        throw new ValidationError("Payment received cannot be more than the bill total.");
      }

      if (input.orderId) {
        const order = await tx.order.findUnique({ where: { id: input.orderId } });
        if (!order) throw new NotFoundError("Order");
        if (order.customerId !== customer.id) throw new ValidationError("This order belongs to a different customer.");
        if (order.cancelledAt || order.closedAt) throw new DomainError("ORDER_NOT_OPEN", "This order is cancelled or closed, so it cannot be billed.");
      }

      const financialYear = financialYearOf();
      const invoiceNumber = await allocateNumber(tx, "INVOICE", financialYear);

      const bill = await tx.bill.create({
        data: {
          invoiceNumber, financialYear, customerId: customer.id,
          customerName: customer.name, customerGstin: customer.gstin, customerAddress: customer.billingAddress,
          customerStateCode: customer.stateCode, customerPhone: customer.phone,
          supplierLegalName: profile.legalName, supplierGstin: profile.gstin, supplierStateCode: profile.stateCode,
          supplierAddress: [profile.addressLine1, profile.addressLine2, `${profile.city} - ${profile.pincode}`].filter(Boolean).join(", "),
          placeOfSupply: preview.placeOfSupply, deliveryAddress: input.deliveryAddress ?? "", notes: input.notes ?? null,
          grossTotal: toFixed2(preview.grossTotal), discountTotal: toFixed2(preview.discountTotal),
          taxableTotal: toFixed2(preview.taxableTotal), cgstTotal: toFixed2(preview.cgstTotal),
          sgstTotal: toFixed2(preview.sgstTotal), igstTotal: toFixed2(preview.igstTotal),
          taxTotal: toFixed2(preview.taxTotal), roundOff: toFixed2(preview.roundOff), grandTotal: toFixed2(preview.grandTotal),
          createdBy: session.userId, idempotencyKey: key, orderId: input.orderId ?? null, rateTier: preview.rateTier,
          lineItems: {
            create: preview.lines.map((l, i) => ({
              lineNo: i + 1, productId: l.productId, productName: l.productName, productSku: l.productSku,
              hsnCode: l.hsnCode, unit: l.unit, qtyPerCarton: l.qtyPerCarton, quantity: toFixed2(l.quantity), unitPrice: toFixed2(l.unitPrice),
              discountAmount: toFixed2(l.discountAmount), taxableValue: toFixed2(l.taxableValue), gstRate: toFixed2(l.gstRate),
              cgstAmount: toFixed2(l.cgstAmount), sgstAmount: toFixed2(l.sgstAmount), igstAmount: toFixed2(l.igstAmount),
              lineTotal: toFixed2(l.lineTotal), shortfallQuantity: l.shortfallQuantity ? toFixed2(l.shortfallQuantity) : null,
            })),
          },
          charges: {
            create: preview.charges.map((c) => ({
              chargeNo: c.chargeNo, kind: c.kind, label: c.label, taxableValue: toFixed2(c.taxableValue), gstRate: toFixed2(c.gstRate),
              cgstAmount: toFixed2(c.cgstAmount), sgstAmount: toFixed2(c.sgstAmount), igstAmount: toFixed2(c.igstAmount), lineTotal: toFixed2(c.lineTotal),
            })),
          },
        },
        include: withLines,
      });

      for (const line of bill.lineItems) {
        await writeLedgerEntry(tx, {
          productId: line.productId, quantityDelta: D(line.quantity).negated(), type: "BILLED",
          reason: `Invoice ${invoiceNumber}`, sourceReference: `bill_line:${line.id}`,
          createdBy: session.userId, idempotencyKey: `bill-line:${line.id}`,
        });
      }

      if (input.initialPayment) {
        await tx.paymentLogEntry.create({
          data: {
            billId: bill.id, amount: toFixed2(input.initialPayment.amount), method: input.initialPayment.method,
            reference: input.initialPayment.reference ?? null, recordedBy: session.userId, idempotencyKey: `${key}:initial-payment`,
          },
        });
      }

      if (profile.einvoicingApplicable && customer.gstin) {
        await tx.irpSubmission.create({ data: { documentType: "INVOICE", billId: bill.id } });
      }
      return bill;
    });
  } catch (error) {
    // A concurrent duplicate lost the race on the unique key; its transaction (and invoice number) rolled back.
    if (isUniqueConstraintError(error)) {
      const winner = await prisma.bill.findUnique({ where: { idempotencyKey: key }, include: withLines });
      if (winner) return winner;
    }
    throw error;
  }
}

export async function listBillableProducts(session: Session | null) {
  requireRole(session, ["OWNER"]);
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, sku: true, name: true, size: true, categoryId: true, category: { select: { name: true } }, unit: true, qtyPerCarton: true, reorderLevel: true, unitPrice: true, rateA: true, rateC: true, gstRate: true },
    orderBy: { name: "asc" },
  });
  const levels = await getStockLevels(prisma, products.map((p) => p.id));
  return products.map(({ category, ...p }) => ({ ...p, categoryName: category?.name ?? null, stock: levels.get(p.id) ?? ZERO }));
}
