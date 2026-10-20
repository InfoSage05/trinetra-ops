"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { createBill, previewBill } from "@/domain/billing";

export async function previewBillAction(draft: unknown) {
  return runAction(async () => previewBill(await getSession(), draft));
}

export async function createBillAction(input: unknown) {
  return runAction(async () => {
    const bill = await createBill(await getSession(), input);
    for (const path of ["/bills", "/inventory", "/dashboard"]) revalidatePath(path);
    return { id: bill.id, invoiceNumber: bill.invoiceNumber };
  });
}
