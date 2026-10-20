"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { recordPayment } from "@/domain/payments";
import { recordReturn } from "@/domain/credit-notes";
import { retryIrpSubmission } from "@/domain/irp";

function refresh(billId?: unknown) {
  if (typeof billId === "string") revalidatePath(`/bills/${billId}`);
  for (const path of ["/bills", "/dashboard", "/inventory"]) revalidatePath(path);
}

export async function recordPaymentAction(input: { billId: string } & Record<string, unknown>) {
  return runAction(async () => { const p = await recordPayment(await getSession(), input); refresh(input.billId); return p; });
}

export async function recordReturnAction(input: { billId: string } & Record<string, unknown>) {
  return runAction(async () => { const n = await recordReturn(await getSession(), input); refresh(input.billId); return n; });
}

export async function retryIrpAction(input: { submissionId: string; billId: string }) {
  return runAction(async () => { const r = await retryIrpSubmission(await getSession(), input); refresh(input.billId); return r; });
}
