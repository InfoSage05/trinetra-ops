import { z } from "zod";
import { prisma, type Db } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { isValidGstin, stateCodeFromGstin } from "@/lib/gst";
import { financialYearOf } from "@/lib/time";
import { optionalText, parseInput, phone, requiredText } from "@/lib/validation";
import type { NumberSeriesType } from "@/domain/numbering";

export const businessProfileSchema = z.object({
  legalName: requiredText("Legal name"),
  tradeName: optionalText(200),
  gstin: z.string().trim().toUpperCase().refine(isValidGstin, "GSTIN is not valid. Check for typos."),
  addressLine1: requiredText("Address", 200),
  addressLine2: optionalText(200),
  city: requiredText("City", 100),
  pincode: z.string().trim().regex(/^\d{6}$/, "PIN code must be 6 digits"),
  phone,
  email: z.union([z.literal(""), z.email("Enter a valid email")]).optional().transform((v) => v || undefined),
  upiId: z
    .string().trim().optional().transform((v) => v || undefined)
    .refine((v) => v === undefined || /^[\w.-]{2,}@[A-Za-z]{2,}$/.test(v), "UPI ID looks wrong (example: name@okhdfcbank)"),
  bankDetails: optionalText(500),
  invoiceTerms: optionalText(1000),
  einvoicingApplicable: z.boolean().default(false),
});

export async function getBusinessProfile(db: Db = prisma) {
  return db.businessProfile.findUnique({ where: { id: "default" } });
}

export async function requireBusinessProfile(db: Db) {
  const profile = await getBusinessProfile(db);
  if (!profile) {
    throw new DomainError("SETUP_INCOMPLETE", "Fill in your business details in Settings before billing.");
  }
  return profile;
}

export async function saveBusinessProfile(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(businessProfileSchema, rawInput);
  const data = {
    ...input,
    tradeName: input.tradeName ?? null, addressLine2: input.addressLine2 ?? null, email: input.email ?? null,
    upiId: input.upiId ?? null, bankDetails: input.bankDetails ?? null, invoiceTerms: input.invoiceTerms ?? null,
    stateCode: stateCodeFromGstin(input.gstin),
  };
  return prisma.businessProfile.upsert({ where: { id: "default" }, create: data, update: data });
}

const seriesSchema = z.object({
  series: z.enum(["INVOICE", "CREDIT_NOTE"]),
  prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,4}$/, "Prefix must be 1-4 letters or digits"),
  financialYear: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export async function ensureNumberSeries(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(seriesSchema, rawInput);
  const financialYear = input.financialYear ?? financialYearOf();
  const key = { series_financialYear: { series: input.series, financialYear } };

  const existing = await prisma.numberSeries.findUnique({ where: key });
  if (!existing) return prisma.numberSeries.create({ data: { series: input.series, financialYear, prefix: input.prefix } });
  if (existing.prefix === input.prefix) return existing;
  if (existing.nextSerial > 1) {
    throw new DomainError("SERIES_IN_USE", "This series has already issued numbers; its prefix can no longer change this year.");
  }
  return prisma.numberSeries.update({ where: key, data: { prefix: input.prefix } });
}

export async function getNumberSeriesStatus(db: Db, financialYear: string = financialYearOf()) {
  const rows = await db.numberSeries.findMany({ where: { financialYear } });
  return (["INVOICE", "CREDIT_NOTE"] as NumberSeriesType[]).map((series) => {
    const row = rows.find((r) => r.series === series);
    return { series, financialYear, exists: Boolean(row), prefix: row?.prefix ?? null, nextSerial: row?.nextSerial ?? null };
  });
}
