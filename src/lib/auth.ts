import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { ForbiddenError } from "@/lib/errors";

export type Role = "OWNER" | "WORKER";
export type SessionClaims = { userId: string; role: Role; sessionVersion: number };
export type Session = { userId: string; role: Role; name: string; mustChangePassword: boolean };

export const SESSION_COOKIE = "tc_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // one working day

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return new TextEncoder().encode(secret);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, Number(process.env.BCRYPT_COST ?? 12));
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role, sv: claims.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    const role = payload.role;
    if (typeof payload.sub !== "string" || (role !== "OWNER" && role !== "WORKER") || typeof payload.sv !== "number") {
      return null;
    }
    return { userId: payload.sub, role, sessionVersion: payload.sv };
  } catch {
    return null;
  }
}

export function requireRole(session: Session | null, allowed: readonly Role[]): asserts session is Session {
  if (!session) throw new ForbiddenError("Your session has ended. Please log in again.");
  if (!allowed.includes(session.role)) throw new ForbiddenError();
}
