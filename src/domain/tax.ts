import Decimal from "decimal.js";
import { ValidationError } from "@/lib/errors";
import { D, round2, roundToRupee, sumDecimals, type DecimalInput } from "@/lib/money";

export type TaxSplit = { cgstAmount: Decimal; sgstAmount: Decimal; igstAmount: Decimal };
export type LineAmounts = TaxSplit & {
  grossAmount: Decimal;
  discountAmount: Decimal;
  taxableValue: Decimal;
  lineTotal: Decimal;
};
export type DocumentTotals = {
  grossTotal: Decimal; discountTotal: Decimal; taxableTotal: Decimal;
  cgstTotal: Decimal; sgstTotal: Decimal; igstTotal: Decimal; taxTotal: Decimal;
  roundOff: Decimal; grandTotal: Decimal;
};

export function isInterState(supplierStateCode: string, placeOfSupply: string): boolean {
  return supplierStateCode !== placeOfSupply;
}

export function taxOnTaxableValue(taxableValue: DecimalInput, gstRate: DecimalInput, interState: boolean): TaxSplit {
  const value = D(taxableValue);
  const rate = D(gstRate);
  if (interState) {
    return { cgstAmount: new Decimal(0), sgstAmount: new Decimal(0), igstAmount: round2(value.times(rate).div(100)) };
  }
  const half = round2(value.times(rate).div(200));
  return { cgstAmount: half, sgstAmount: half, igstAmount: new Decimal(0) };
}

export function computeLine(
  input: { quantity: DecimalInput; unitPrice: DecimalInput; discountAmount?: DecimalInput; gstRate: DecimalInput; priceIncludesGst?: boolean },
  interState: boolean
): LineAmounts {
  const grossAmount = round2(D(input.quantity).times(D(input.unitPrice)));
  const discountAmount = round2(input.discountAmount ?? 0);
  if (discountAmount.isNegative() || discountAmount.greaterThan(grossAmount)) {
    throw new ValidationError("Discount must be between 0 and the line amount.");
  }
  const amountAfterDiscount = grossAmount.minus(discountAmount);
  // Rates entered by this business are GST-inclusive. The CGST/SGST columns are
  // informational percentages of the entered line amount and never change it.
  const taxableValue = amountAfterDiscount;
  const tax = taxOnTaxableValue(taxableValue, input.gstRate, interState);
  const lineTotal = input.priceIncludesGst ? amountAfterDiscount : taxableValue.plus(tax.cgstAmount).plus(tax.sgstAmount).plus(tax.igstAmount);
  return { grossAmount, discountAmount, taxableValue, ...tax, lineTotal };
}

export function computeTotals(
  lines: Array<TaxSplit & { taxableValue: Decimal; grossAmount?: Decimal; discountAmount?: Decimal }>,
  taxAlreadyIncluded = false,
): DocumentTotals {
  const taxableTotal = sumDecimals(lines.map((l) => l.taxableValue));
  const cgstTotal = sumDecimals(lines.map((l) => l.cgstAmount));
  const sgstTotal = sumDecimals(lines.map((l) => l.sgstAmount));
  const igstTotal = sumDecimals(lines.map((l) => l.igstAmount));
  const taxTotal = cgstTotal.plus(sgstTotal).plus(igstTotal);
  const amount = taxAlreadyIncluded
    ? sumDecimals(lines.map((l) => D(l.grossAmount ?? l.taxableValue)))
    : taxableTotal.plus(taxTotal);
  const { rounded, roundOff } = roundToRupee(amount);
  return {
    grossTotal: sumDecimals(lines.map((l) => l.grossAmount ?? l.taxableValue)),
    discountTotal: sumDecimals(lines.map((l) => l.discountAmount ?? 0)),
    taxableTotal, cgstTotal, sgstTotal, igstTotal, taxTotal, roundOff, grandTotal: rounded,
  };
}
