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

export type ProductRowInput = { rowNumber: number; sku?: string; name?: string; hsnCode?: string; gstRate?: string; unitPrice?: string; unit?: string; qtyPerCarton?: string; reorderLevel?: string };
export type OpeningRowInput = { rowNumber: number; sku?: string; name?: string; quantity?: string };

export function mapProductRows(rows: SheetRow[]): ProductRowInput[] {
  return rows.map(({ rowNumber, values: v }) => ({
    rowNumber,
    sku: pick(v, ["sku", "code", "itemcode"]),
    name: pick(v, ["name", "productname", "item"]),
    hsnCode: pick(v, ["hsn", "hsncode"]),
    gstRate: pick(v, ["gst", "gstrate", "gstpercent", "taxrate"]),
    unitPrice: pick(v, ["price", "unitprice", "rate", "mrp"]),
    unit: pick(v, ["unit", "uom"]),
    qtyPerCarton: pick(v, ["qtypercarton", "qtypercartoon", "piecespercarton", "pcspercarton", "pcspercartoon", "qtyperctn", "cartonsize", "cartonqty", "percarton"]),
    reorderLevel: pick(v, ["reorderlevel", "reorder", "minstock"]),
  }));
}

export function mapOpeningStockRows(rows: SheetRow[]): OpeningRowInput[] {
  return rows.map(({ rowNumber, values: v }) => ({
    rowNumber,
    sku: pick(v, ["sku", "code", "itemcode"]),
    name: pick(v, ["name", "productname", "item", "itemname", "descriptionofgoods"]),
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
  const valid: { data: z.output<typeof productSchema>; sizeGiven: boolean }[] = [];
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
      continue;
    }
    // An item is known by its code when it has one, otherwise by its name.
    const key = result.data.sku ? `sku:${result.data.sku}` : `name:${result.data.name.toLowerCase()}`;
    if (seen.has(key)) {
      errors.push({ rowNumber: row.rowNumber, message: `${result.data.sku ? `Code ${result.data.sku}` : `"${result.data.name}"`} appears more than once in the file` });
      continue;
    }
    seen.add(key);
    // A price-list sheet with no carton column must not reset carton sizes the owner already set.
    valid.push({ data: result.data, sizeGiven: String(row.qtyPerCarton ?? "").trim() !== "" });
  }

  const [bySku, byName] = await Promise.all([
    prisma.product.findMany({ where: { sku: { in: valid.flatMap((v) => (v.data.sku ? [v.data.sku] : [])) } }, select: { id: true, sku: true } }),
    prisma.product.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  const idBySku = new Map(bySku.map((p) => [p.sku!, p.id]));
  const idByName = new Map(byName.map((p) => [p.name.toLowerCase(), p.id]));
  const planned = valid.map((v) => ({ ...v, existingId: (v.data.sku ? idBySku.get(v.data.sku) : undefined) ?? idByName.get(v.data.name.toLowerCase()) }));

  const summary = { errors, toCreate: planned.filter((v) => !v.existingId).length, toUpdate: planned.filter((v) => v.existingId).length, created: 0, updated: 0 };
  if (dryRun || errors.length > 0) return summary;

  await prisma.$transaction(async (tx) => {
    for (const { data: p, sizeGiven, existingId } of planned) {
      const data = { ...p, sku: p.sku ?? null, unitPrice: toFixed2(p.unitPrice), gstRate: toFixed2(p.gstRate), reorderLevel: toFixed2(p.reorderLevel) };
      if (!existingId) {
        await tx.product.create({ data });
      } else {
        const { qtyPerCarton, sku, ...rest } = data;
        // Keep the item's existing code when the sheet does not give one.
        await tx.product.update({ where: { id: existingId }, data: { ...rest, ...(sizeGiven ? { qtyPerCarton } : {}), ...(sku ? { sku } : {}) } });
      }
    }
  });
  return { ...summary, created: summary.toCreate, updated: summary.toUpdate };
}
