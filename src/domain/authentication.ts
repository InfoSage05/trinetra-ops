import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { verifyPassword, type SessionClaims } from "@/lib/auth";
import { phone as phoneSchema } from "@/lib/validation";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

const GENERIC_ERROR = "Wrong phone number or password.";
// Comparing against a dummy hash keeps response time similar whether or not the number exists.
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser", 4);

export type AuthResult = { ok: true; claims: SessionClaims } | { ok: false; error: string };

export async function authenticate(rawPhone: string, password: string, now: Date = new Date()): Promise<AuthResult> {
  const parsed = phoneSchema.safeParse(rawPhone);
  const user = parsed.success ? await prisma.user.findUnique({ where: { phone: parsed.data } }) : null;

  if (!user || !user.isActive) {
    await verifyPassword(password, DUMMY_HASH);
    return { ok: false, error: GENERIC_ERROR };
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000);
    return { ok: false, error: `Too many wrong attempts. Try again in ${minutes} minute(s).` };
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await prisma.user.update({
      where: { id: user.id },
      data: lock
        ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) }
        : { failedLoginCount: failed },
    });
    return { ok: false, error: lock ? `Too many wrong attempts. Try again in ${LOCKOUT_MINUTES} minute(s).` : GENERIC_ERROR };
  }

  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  }
  return { ok: true, claims: { userId: user.id, role: user.role, sessionVersion: user.sessionVersion } };
}
