"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { ValidationError } from "@/lib/errors";
import { getSession } from "@/lib/session";
import { parseSpreadsheet } from "@/lib/spreadsheet";
import { createProduct, renameProduct, setProductActive, updateProduct } from "@/domain/products";
import { importProducts, mapProductRows } from "@/domain/imports";

const refresh = () => { revalidatePath("/products"); revalidatePath("/inventory"); };

export async function createProductAction(input: unknown) {
  return runAction(async () => { const p = await createProduct(await getSession(), input); refresh(); return p; });
}

export async function updateProductAction(input: unknown) {
  return runAction(async () => { const p = await updateProduct(await getSession(), input); refresh(); return p; });
}

export async function renameProductAction(input: unknown) {
  return runAction(async () => { const p = await renameProduct(await getSession(), input); refresh(); revalidatePath(`/inventory/${p.id}`); return p; });
}

export async function setProductActiveAction(input: unknown) {
  return runAction(async () => { const p = await setProductActive(await getSession(), input); refresh(); return p; });
}

export async function importProductsAction(formData: FormData) {
  return runAction(async () => {
    const session = await getSession(); // checked again inside importProducts
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose an Excel or CSV file.");
    const { rows } = await parseSpreadsheet(await file.arrayBuffer(), file.name);
    const result = await importProducts(session, { rows: mapProductRows(rows), dryRun: formData.get("dryRun") !== "false" });
    if (result.created || result.updated) refresh();
    return result;
  });
}
