import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { isValidGstin, isValidHsn, isValidStateCode } from "@/lib/gst";

const DECIMAL_2DP = /^-?\d{1,10}(\.\d{1,2})?$/;

function decimalField(message: string, check: (n: number) => boolean) {
  return z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().replace(/,/g, ""))
    .refine((v) => DECIMAL_2DP.test(v) && check(Number(v)), message);
}

export const quantity = decimalField("Enter a quantity greater than 0 (up to 2 decimals).", (n) => n > 0);
export const nonNegativeQuantity = decimalField("Enter 0 or more (up to 2 decimals).", (n) => n >= 0);
export const signedQuantity = decimalField("Enter a non-zero quantity, e.g. -3 or 5.", (n) => n !== 0);
export const money = decimalField("Enter an amount of 0 or more (up to 2 decimals).", (n) => n >= 0);
export const positiveMoney = decimalField("Enter an amount greater than 0.", (n) => n > 0);
export const signedMoney = decimalField("Enter a non-zero amount (use minus for a refund).", (n) => n !== 0);
export const gstRate = decimalField("GST rate must be between 0 and 40.", (n) => n >= 0 && n <= 40);

export const entityId = z.string().trim().min(1, "Required");
export const idempotencyKey = z.string().trim().min(8).max(200);

export const requiredText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);

export const optionalText = (max = 500) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const phone = z
  .string()
  .transform((v) => v.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, ""))
  .refine((v) => /^[6-9]\d{9}$/.test(v), "Enter a 10-digit mobile number");

export const stateCode = z.string().trim().refine(isValidStateCode, "Choose a state");

export const optionalGstin = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || isValidGstin(v), "GSTIN is not valid. Check for typos.");

export const hsnCode = z.string().trim().refine(isValidHsn, "HSN must be 4, 6 or 8 digits");

/** Validates and normalises input, throwing a ValidationError with a readable first message. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const flat = z.flattenError(result.error);
    throw new ValidationError(
      result.error.issues[0]?.message ?? "Some details are not valid.",
      flat.fieldErrors as Record<string, string[]>
    );
  }
  return result.data;
}
