import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole, type Session } from "@/lib/auth";
import type { SheetRow } from "@/lib/spreadsheet";
import { toFixed2 } from "@/lib/money";
import { parseInput } from "@/lib/validation";
import { productSchema } from "@/domain/products";

function pick(values: Record<string, string>, aliases: string[]): string | undefined {
  for (const alias of aliases) if (values[alias] !== undefined && values[alias] !== "") return values[alias];
  return undefined;
}

export type ProductRowInput = { rowNumber: number; sku?: string; name?: string; hsnCode?: string; gstRate?: string; unitPrice?: string; unit?: string; reorderLevel?: string };
export type OpeningRowInput = { rowNumber: number; sku?: string; quantity?: string };

export function mapProductRows(rows: SheetRow[]): ProductRowInput[] {
  return rows.map(({ rowNumber, values: v }) => ({
    rowNumber,
    sku: pick(v, ["sku", "code", "itemcode"]),
    name: pick(v, ["name", "productname", "item"]),
    hsnCode: pick(v, ["hsn", "hsncode"]),
    gstRate: pick(v, ["gst", "gstrate", "gstpercent", "taxrate"]),
    unitPrice: pick(v, ["price", "unitprice", "rate", "mrp"]),
    unit: pick(v, ["unit", "uom"]),
    reorderLevel: pick(v, ["reorderlevel", "reorder", "minstock"]),
  }));
}

export function mapOpeningStockRows(rows: SheetRow[]): OpeningRowInput[] {
  return rows.map(({ rowNumber, values: v }) => ({
    rowNumber,
    sku: pick(v, ["sku", "code", "itemcode"]),
    quantity: pick(v, ["quantity", "qty", "stock", "openingstock"]),
  }));
}

const importProductsSchema = z.object({
  rows: z.array(z.object({ rowNumber: z.number().int() }).passthrough()).max(2000),
  dryRun: z.boolean().default(true),
});

export async function importProducts(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const { rows, dryRun } = parseInput(importProductsSchema, rawInput);

  const errors: { rowNumber: number; message: string }[] = [];
  const valid: z.output<typeof productSchema>[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const result = productSchema.safeParse(row);
    const gst = Number(String(row.gstRate ?? "").replace(/,/g, ""));
    if (result.success && gst > 0 && gst < 1 && gst !== 0.25) {
      // Excel stores a %-formatted 18% cell as 0.18; importing that would charge 0.18% GST.
      errors.push({ rowNumber: row.rowNumber, message: `GST "${row.gstRate}" looks like a fraction. Type 18 for 18% (or format the column as a plain number).` });
      continue;
    }
    if (!result.success) {
      errors.push({ rowNumber: row.rowNumber, message: result.error.issues[0]?.message ?? "Invalid row" });
    } else if (seen.has(result.data.sku)) {
      errors.push({ rowNumber: row.rowNumber, message: `SKU ${result.data.sku} appears more than once in the file` });
    } else {
      seen.add(result.data.sku);
      valid.push(result.data);
    }
  }

  const existing = new Set(
    (await prisma.product.findMany({ where: { sku: { in: valid.map((v) => v.sku) } }, select: { sku: true } })).map((p) => p.sku)
  );
  const summary = { errors, toCreate: valid.filter((v) => !existing.has(v.sku)).length, toUpdate: valid.filter((v) => existing.has(v.sku)).length, created: 0, updated: 0 };
  if (dryRun || errors.length > 0) return summary;

  await prisma.$transaction(async (tx) => {
    for (const p of valid) {
      const data = { ...p, unitPrice: toFixed2(p.unitPrice), gstRate: toFixed2(p.gstRate), reorderLevel: toFixed2(p.reorderLevel) };
      await tx.product.upsert({ where: { sku: p.sku }, create: data, update: data });
    }
  });
  return { ...summary, created: summary.toCreate, updated: summary.toUpdate };
}
