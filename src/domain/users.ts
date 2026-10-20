import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, requireRole, verifyPassword, type Session, type SessionClaims } from "@/lib/auth";
import { DomainError, NotFoundError } from "@/lib/errors";
import { entityId, parseInput, phone, requiredText } from "@/lib/validation";

const password = z.string().min(8, "Password must be at least 8 characters").max(72, "Password is too long");

const publicFields = { id: true, name: true, phone: true, role: true, isActive: true, mustChangePassword: true, createdAt: true } as const;

export async function createUser(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(
    z.object({ name: requiredText("Name", 100), phone, role: z.enum(["OWNER", "WORKER"]), temporaryPassword: password }),
    rawInput
  );
  if (await prisma.user.findUnique({ where: { phone: input.phone } })) {
    throw new DomainError("DUPLICATE_PHONE", "Someone already uses this mobile number to log in.");
  }
  return prisma.user.create({
    data: { name: input.name, phone: input.phone, role: input.role, passwordHash: await hashPassword(input.temporaryPassword), mustChangePassword: true },
    select: publicFields,
  });
}

export async function setUserActive(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(z.object({ userId: entityId, isActive: z.boolean() }), rawInput);
  if (input.userId === session.userId && !input.isActive) {
    throw new DomainError("CANNOT_DEACTIVATE_SELF", "You cannot deactivate your own login.");
  }
  return prisma.user.update({
    where: { id: input.userId },
    data: { isActive: input.isActive, sessionVersion: { increment: 1 } },
    select: publicFields,
  });
}

export async function setTemporaryPassword(session: Session | null, rawInput: unknown) {
  requireRole(session, ["OWNER"]);
  const input = parseInput(z.object({ userId: entityId, temporaryPassword: password }), rawInput);
  return prisma.user.update({
    where: { id: input.userId },
    data: {
      passwordHash: await hashPassword(input.temporaryPassword), mustChangePassword: true,
      failedLoginCount: 0, lockedUntil: null, sessionVersion: { increment: 1 },
    },
    select: publicFields,
  });
}

export async function changeOwnPassword(session: Session | null, rawInput: unknown): Promise<SessionClaims> {
  requireRole(session, ["OWNER", "WORKER"]);
  const input = parseInput(
    z.object({ currentPassword: z.string().min(1), newPassword: password })
      .refine((v) => v.currentPassword !== v.newPassword, { message: "Choose a different new password", path: ["newPassword"] }),
    rawInput
  );
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) throw new NotFoundError("User");
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new DomainError("WRONG_PASSWORD", "Your current password is not correct.");
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, sessionVersion: { increment: 1 } },
  });
  return { userId: updated.id, role: updated.role, sessionVersion: updated.sessionVersion };
}

export async function listUsers(session: Session | null) {
  requireRole(session, ["OWNER"]);
  return prisma.user.findMany({ select: publicFields, orderBy: [{ role: "asc" }, { name: "asc" }] });
}
