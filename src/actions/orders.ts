"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { proposeOrder } from "@/domain/ai-orders";
import { cancelOrder, closeOrder, createOrder } from "@/domain/orders";

const refresh = () => { for (const p of ["/orders", "/dashboard"]) revalidatePath(p); };

export async function proposeOrderAction(input: unknown) {
  return runAction(async () => proposeOrder(await getSession(), input));
}
export async function createOrderAction(input: unknown) {
  return runAction(async () => { const r = await createOrder(await getSession(), input); refresh(); return r; });
}
export async function cancelOrderAction(input: unknown) {
  return runAction(async () => { const r = await cancelOrder(await getSession(), input); refresh(); return r; });
}
export async function closeOrderAction(input: unknown) {
  return runAction(async () => { const r = await closeOrder(await getSession(), input); refresh(); return r; });
}
