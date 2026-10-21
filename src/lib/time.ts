export const IST_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60 * 1000;

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

export function istDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = partsFormatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Indian financial year (April-March) in IST, e.g. "2026-27". */
export function financialYearOf(date: Date = new Date()): string {
  const { year, month } = istDateParts(date);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function financialYearShort(financialYear: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(financialYear);
  if (!match) throw new Error(`Invalid financial year "${financialYear}"`);
  return `${match[1].slice(2)}${match[2]}`;
}

export function istDayRange(date: Date = new Date()): { start: Date; end: Date } {
  const { year, month, day } = istDateParts(date);
  const start = new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export function formatDateIN(date: Date): string {
  const { year, month, day } = istDateParts(date);
  return `${String(day).padStart(2, "0")}-${String(month).padStart(2, "0")}-${year}`;
}

/** From the start of the `from` day to the end of the `to` day in IST (dates as YYYY-MM-DD). */
export function istRange(from: string, to: string): { start: Date; end: Date } {
  const start = new Date(Date.parse(`${from}T00:00:00Z`) - IST_OFFSET_MS);
  const end = new Date(Date.parse(`${to}T00:00:00Z`) + 24 * 60 * 60 * 1000 - IST_OFFSET_MS);
  return { start, end };
}

/** Today's date in IST as YYYY-MM-DD. */
export function istToday(date: Date = new Date()): string {
  const { year, month, day } = istDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
