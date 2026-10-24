import Decimal from "decimal.js";

export type DecimalInput = Decimal.Value | { toString(): string };

/** Converts strings, numbers, decimal.js values and Prisma Decimal objects into decimal.js. */
export function D(value: DecimalInput): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "object" && value !== null) return new Decimal(value.toString());
  return new Decimal(value);
}

export const ZERO = new Decimal(0);

export function round2(value: DecimalInput): Decimal {
  return D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function sumDecimals(values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Decimal(0));
}

/** The canonical way to hand a money/quantity value to Prisma. */
export function toFixed2(value: DecimalInput): string {
  return round2(value).toFixed(2);
}

/** A rate per piece kept to 4 decimals (a dozen rate divided by 12 does not fit in 2). */
export function toFixed4(value: DecimalInput): string {
  return D(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

export function roundToRupee(value: DecimalInput): { rounded: Decimal; roundOff: Decimal } {
  const exact = round2(value);
  const rounded = exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return { rounded, roundOff: rounded.minus(exact) };
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatINR(value: DecimalInput): string {
  return inr.format(round2(value).toNumber());
}

const plain = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Amount for table cells: Indian digit grouping, always 2 decimals, no currency sign. */
export function formatAmount(value: DecimalInput): string {
  return plain.format(round2(value).toNumber());
}

export function formatQuantity(value: DecimalInput): string {
  return round2(value).toString(); // "12.5", "12", "-3"
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  const unit = n % 10;
  return unit ? `${TENS[Math.floor(n / 10)]} ${ONES[unit]}` : TENS[Math.floor(n / 10)];
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

function integerToIndianWords(n: number): string {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1_000);
  const rest = n % 1_000;
  return [
    crore ? `${integerToIndianWords(crore)} Crore` : "",
    lakh ? `${belowHundred(lakh)} Lakh` : "",
    thousand ? `${belowHundred(thousand)} Thousand` : "",
    rest ? belowThousand(rest) : "",
  ].filter(Boolean).join(" ");
}

export function amountInWords(value: DecimalInput): string {
  const amount = round2(value).abs();
  const rupees = amount.floor();
  const paise = amount.minus(rupees).times(100).toNumber();
  const paiseWords = paise ? ` and ${belowHundred(paise)} Paise` : "";
  return `${integerToIndianWords(rupees.toNumber())} Rupees${paiseWords} Only`;
}
