"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { assignCategory, createCategory, deleteCategory, renameCategory } from "@/domain/categories";

const refresh = () => { for (const p of ["/products", "/inventory", "/billing/new"]) revalidatePath(p); };

export async function createCategoryAction(input: unknown) {
  return runAction(async () => { const r = await createCategory(await getSession(), input); refresh(); return r; });
}
export async function renameCategoryAction(input: unknown) {
  return runAction(async () => { const r = await renameCategory(await getSession(), input); refresh(); return r; });
}
export async function deleteCategoryAction(input: unknown) {
  return runAction(async () => { const r = await deleteCategory(await getSession(), input); refresh(); return r; });
}
export async function assignCategoryAction(input: unknown) {
  return runAction(async () => { const r = await assignCategory(await getSession(), input); refresh(); return r; });
}
