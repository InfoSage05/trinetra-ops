"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { createUser, setTemporaryPassword, setUserActive } from "@/domain/users";

export async function createUserAction(input: unknown) {
  return runAction(async () => { const u = await createUser(await getSession(), input); revalidatePath("/users"); return u; });
}

export async function setUserActiveAction(input: unknown) {
  return runAction(async () => { const u = await setUserActive(await getSession(), input); revalidatePath("/users"); return u; });
}

export async function setTemporaryPasswordAction(input: unknown) {
  return runAction(async () => { const u = await setTemporaryPassword(await getSession(), input); revalidatePath("/users"); return u; });
}
