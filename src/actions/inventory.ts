"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { parseSpreadsheet } from "@/lib/spreadsheet";
import { adjustStock, importOpeningStock, previewOpeningStock, recordProduction } from "@/domain/stock";
import { approveStockCount, discardStockCount, submitStockCount } from "@/domain/stock-counts";
import { mapOpeningStockRows } from "@/domain/imports";

const refresh = () => { for (const p of ["/inventory", "/inventory/counts", "/dashboard"]) revalidatePath(p); };

export async function recordProductionAction(input: unknown) {
  return runAction(async () => { const r = await recordProduction(await getSession(), input); refresh(); return r; });
}
export async function adjustStockAction(input: unknown) {
  return runAction(async () => { const r = await adjustStock(await getSession(), input); refresh(); return r; });
}
export async function submitStockCountAction(input: unknown) {
  return runAction(async () => { const r = await submitStockCount(await getSession(), input); refresh(); return r; });
}
export async function approveStockCountAction(input: unknown) {
  return runAction(async () => { const r = await approveStockCount(await getSession(), input); refresh(); return r; });
}
export async function discardStockCountAction(input: unknown) {
  return runAction(async () => { const r = await discardStockCount(await getSession(), input); refresh(); return r; });
}

async function openingInput(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose an Excel or CSV file.");
  const { rows } = await parseSpreadsheet(await file.arrayBuffer(), file.name);
  return { importBatchId: String(formData.get("importBatchId") ?? ""), rows: mapOpeningStockRows(rows) };
}

export async function previewOpeningStockAction(formData: FormData) {
  return runAction(async () => previewOpeningStock(await getSession(), await openingInput(formData)));
}
export async function importOpeningStockAction(formData: FormData) {
  return runAction(async () => { const r = await importOpeningStock(await getSession(), await openingInput(formData)); refresh(); return r; });
}
