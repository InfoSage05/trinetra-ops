import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { authenticate, MAX_FAILED_LOGINS } from "@/domain/authentication";
import { resetDb } from "../helpers/db";

async function createUser(isActive = true) {
  return prisma.user.create({
    data: { name: "Worker", phone: "9876543210", passwordHash: await hashPassword("secret-pass-1"), role: "WORKER", isActive },
  });
}

describe("authenticate", () => {
  beforeEach(resetDb);

  it("accepts the right phone (in any common format) and password", async () => {
    const user = await createUser();
    const result = await authenticate("+91 98765 43210", "secret-pass-1");
    expect(result).toEqual({ ok: true, claims: { userId: user.id, role: "WORKER", sessionVersion: 0 } });
  });

  it("gives the same generic error for wrong password and unknown phone", async () => {
    await createUser();
    const wrongPassword = await authenticate("9876543210", "nope");
    const unknownPhone = await authenticate("9123456789", "nope");
    expect(wrongPassword).toEqual({ ok: false, error: "Wrong phone number or password." });
    expect(unknownPhone).toEqual(wrongPassword);
  });

  it("rejects deactivated users", async () => {
    await createUser(false);
    expect((await authenticate("9876543210", "secret-pass-1")).ok).toBe(false);
  });

  it("locks the account after repeated failures, even for the right password", async () => {
    await createUser();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await authenticate("9876543210", "nope");
    const locked = await authenticate("9876543210", "secret-pass-1");
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error).toMatch(/Too many wrong attempts/);

    const later = new Date(Date.now() + 16 * 60 * 1000);
    expect((await authenticate("9876543210", "secret-pass-1", later)).ok).toBe(true);
  });
});
