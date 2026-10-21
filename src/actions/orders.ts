"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { requireRole } from "@/lib/auth";
import { ValidationError } from "@/lib/errors";
import { proposeOrder, proposeOrderFromImage } from "@/domain/ai-orders";
import { cancelOrder, closeOrder, createOrder } from "@/domain/orders";

const refresh = () => { for (const p of ["/orders", "/dashboard"]) revalidatePath(p); };

export async function proposeOrderAction(input: unknown) {
  return runAction(async () => proposeOrder(await getSession(), input));
}
/** A photo of an order, sent as form data (the browser cannot pass a File as plain JSON). */
export async function proposeOrderFromImageAction(formData: FormData) {
  return runAction(async () => {
    const session = await getSession();
    requireRole(session, ["OWNER"]);
    const file = formData.get("image");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose a photo.");
    const customerId = String(formData.get("customerId") ?? "").trim();
    return proposeOrderFromImage(session, { image: new Uint8Array(await file.arrayBuffer()), ...(customerId ? { customerId } : {}) });
  });
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
