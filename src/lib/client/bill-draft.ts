import type { Charges, Line } from "@/components/bill-lines";
import type { SavedCustomer } from "@/components/customer-dialog";
import type { RateTier } from "@/lib/rates";

/** The bill being typed, kept in this browser until it is saved. */
export const DRAFT_KEY = "trinetra.billDraft";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // a draft older than a day is forgotten

export type BillDraft = {
  savedAt: number;
  customer: SavedCustomer | null;
  placeOfSupply: string;
  rateTier: RateTier;
  deliveryAddress: string;
  notes: string;
  lines: Omit<Line, "rowId">[];
  charges: Charges;
  payMode: "FULL" | "PART" | "CREDIT";
  paidAmount: string;
  method: string;
};

/** Reads what was saved; anything missing, damaged or old gives null (an empty form), never an error. */
export function parseDraft(raw: string): BillDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<BillDraft>;
    if (typeof d.savedAt !== "number" || Date.now() - d.savedAt > MAX_AGE_MS) return null;
    if (!Array.isArray(d.lines) || !d.charges || typeof d.placeOfSupply !== "string") return null;
    return d as BillDraft;
  } catch {
    return null;
  }
}
