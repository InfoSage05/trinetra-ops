import type { Db } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { financialYearShort } from "@/lib/time";

export type NumberSeriesType = "INVOICE" | "CREDIT_NOTE";
export const MAX_SERIAL = 99_999;
const LABEL: Record<NumberSeriesType, string> = { INVOICE: "invoice", CREDIT_NOTE: "credit note" };

export function formatDocumentNumber(prefix: string, financialYear: string, serial: number): string {
  if (!/^[A-Z0-9]{1,4}$/.test(prefix)) {
    throw new DomainError("INVALID_PREFIX", "Number prefix must be 1-4 capital letters or digits.");
  }
  if (!Number.isInteger(serial) || serial < 1 || serial > MAX_SERIAL) {
    throw new DomainError("SERIES_EXHAUSTED", `Number series exhausted at ${MAX_SERIAL}; create a new prefix.`);
  }
  // GST Rule 46: consecutive serial, <= 16 characters, only alphanumerics, "-" and "/".
  return `${prefix}/${financialYearShort(financialYear)}/${String(serial).padStart(5, "0")}`;
}

/** Must be called inside the transaction that creates the document, so a rollback returns the number. */
export async function allocateNumber(db: Db, series: NumberSeriesType, financialYear: string): Promise<string> {
  const rows = await db.$queryRaw<{ serial: number; prefix: string }[]>`
    UPDATE "number_series"
    SET "nextSerial" = "nextSerial" + 1
    WHERE "series" = ${series} AND "financialYear" = ${financialYear}
    RETURNING "nextSerial" - 1 AS "serial", "prefix"`;
  if (rows.length === 0) {
    throw new DomainError(
      "SERIES_MISSING",
      `No ${LABEL[series]} number series is set up for financial year ${financialYear}. Set it up in Settings → Number series.`
    );
  }
  return formatDocumentNumber(rows[0].prefix, financialYear, Number(rows[0].serial));
}
