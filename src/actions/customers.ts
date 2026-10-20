"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { createCustomer, searchCustomers, setCustomerActive, updateCustomer } from "@/domain/customers";

export async function createCustomerAction(input: unknown) {
  return runAction(async () => { const c = await createCustomer(await getSession(), input); revalidatePath("/customers"); return c; });
}

export async function updateCustomerAction(input: unknown) {
  return runAction(async () => { const c = await updateCustomer(await getSession(), input); revalidatePath("/customers"); return c; });
}

export async function setCustomerActiveAction(input: unknown) {
  return runAction(async () => { const c = await setCustomerActive(await getSession(), input); revalidatePath("/customers"); return c; });
}

export async function searchCustomersAction(query: string) {
  return runAction(async () => searchCustomers(await getSession(), { query, limit: 20 }));
}
