import Decimal from "decimal.js";
import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError, NotFoundError, ValidationError } from "@/lib/errors";
import { stateName } from "@/lib/gst";
import { D, ZERO } from "@/lib/money";
import { entityId, money, optionalText, parseInput, quantity, stateCode } from "@/lib/validation";
import { computeLine, computeTotals, isInterState, type DocumentTotals, type LineAmounts } from "@/domain/tax";
import { getStockLevels } from "@/domain/stock";
import { requireBusinessProfile } from "@/domain/settings";

export const PAYMENT_METHODS = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"] as const;

export const billLineSchema = z.object({
  productId: entityId,
  quantity,
  unitPrice: money.optional(),
  discountAmount: money.optional(),
});

export const billDraftSchema = z.object({
  customerId: entityId,
  placeOfSupply: stateCode,
  deliveryAddress: optionalText(300),
  notes: optionalText(500),
  lines: z.array(billLineSchema).min(1, "Add at least one item.").max(100, "A bill can have at most 100 lines."),
});

export type BillDraft = z.output<typeof billDraftSchema>;

export type PreviewLine = LineAmounts & {
  productId: string; productName: string; productSku: string; hsnCode: string; unit: string;
  quantity: Decimal; unitPrice: Decimal; gstRate: Decimal;
  availableBefore: Decimal; shortfallQuantity: Decimal | null;
};

export type BillPreview = DocumentTotals & {
  customerId: string; customerName: string; placeOfSupply: string; placeOfSupplyName: string;
  interState: boolean; hasShortfall: boolean; lines: PreviewLine[];
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

  const lines: PreviewLine[] = draft.lines.map((line, index) => {
    const product = products.get(line.productId);
    if (!product) throw new NotFoundError(`Product on line ${index + 1}`);
    if (!product.isActive) throw new DomainError("PRODUCT_INACTIVE", `${product.name} is marked inactive.`);

    const qty = D(line.quantity);
    const unitPrice = D(line.unitPrice ?? product.unitPrice);
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
      quantity: qty, unitPrice, gstRate: D(product.gstRate),
      availableBefore, shortfallQuantity: qty.greaterThan(usable) ? qty.minus(usable) : null,
    };
  });

  const preview: BillPreview = {
    ...computeTotals(lines),
    customerId: customer.id, customerName: customer.name,
    placeOfSupply: draft.placeOfSupply, placeOfSupplyName: stateName(draft.placeOfSupply),
    interState, hasShortfall: lines.some((l) => l.shortfallQuantity !== null), lines,
  };
  return { preview, profile, customer };
}

export async function previewBill(session: Session | null, rawInput: unknown): Promise<BillPreview> {
  requireRole(session, ["OWNER"]);
  return (await computeBill(prisma, parseInput(billDraftSchema, rawInput))).preview;
}
