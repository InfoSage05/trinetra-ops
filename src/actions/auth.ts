"use server";

import { runAction } from "@/lib/action-result";
import { DomainError } from "@/lib/errors";
import { getSession, setSessionCookie } from "@/lib/session";
import { authenticate } from "@/domain/authentication";
import { changeOwnPassword } from "@/domain/users";

export async function loginAction(input: { phone: string; password: string }) {
  return runAction(async () => {
    const result = await authenticate(String(input?.phone ?? ""), String(input?.password ?? ""));
    if (!result.ok) throw new DomainError("LOGIN_FAILED", result.error);
    await setSessionCookie(result.claims);
    return { role: result.claims.role };
  });
}

export async function changePasswordAction(input: { currentPassword: string; newPassword: string }) {
  return runAction(async () => {
    const claims = await changeOwnPassword(await getSession(), input);
    await setSessionCookie(claims);
    return { changed: true };
  });
}
