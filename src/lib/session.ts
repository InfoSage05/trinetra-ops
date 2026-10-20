import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSessionToken, verifySessionToken, type Session, type SessionClaims } from "@/lib/auth";

/** The authoritative session check: valid token AND active user AND current session version. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;
  const user = await prisma.user.findUnique({ where: { id: claims.userId } });
  if (!user || !user.isActive || user.sessionVersion !== claims.sessionVersion) return null;
  return { userId: user.id, role: user.role, name: user.name, mustChangePassword: user.mustChangePassword };
}

export async function setSessionCookie(claims: SessionClaims): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, await signSessionToken(claims), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
