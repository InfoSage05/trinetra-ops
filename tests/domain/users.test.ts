import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createUser, setUserActive, setTemporaryPassword, changeOwnPassword, listUsers } from "@/domain/users";
import { authenticate } from "@/domain/authentication";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

describe("users", () => {
  beforeEach(resetDb);

  it("lets the owner add a worker who must change the temporary password", async () => {
    const owner = await makeUser("OWNER");
    const worker = await createUser(owner, { name: "Sita", phone: "9876543211", role: "WORKER", temporaryPassword: "temp-pass-1" });
    expect(worker.mustChangePassword).toBe(true);
    expect((await authenticate("9876543211", "temp-pass-1")).ok).toBe(true);
    await expect(createUser(owner, { name: "Dup", phone: "9876543211", role: "WORKER", temporaryPassword: "temp-pass-1" }))
      .rejects.toMatchObject({ code: "DUPLICATE_PHONE" });
  });

  it("deactivating a worker ends their sessions; the owner cannot deactivate themselves", async () => {
    const owner = await makeUser("OWNER");
    const worker = await makeUser("WORKER");
    await setUserActive(owner, { userId: worker.userId, isActive: false });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: worker.userId } });
    expect(row.isActive).toBe(false);
    expect(row.sessionVersion).toBe(1);
    await expect(setUserActive(owner, { userId: owner.userId, isActive: false })).rejects.toMatchObject({ code: "CANNOT_DEACTIVATE_SELF" });
  });

  it("resets a worker's password and unlocks them", async () => {
    const owner = await makeUser("OWNER");
    const worker = await makeUser("WORKER", { phone: "9876543212", password: "old-pass-12" });
    await prisma.user.update({ where: { id: worker.userId }, data: { lockedUntil: new Date(Date.now() + 600_000) } });
    await setTemporaryPassword(owner, { userId: worker.userId, temporaryPassword: "fresh-pass-1" });
    expect((await authenticate("9876543212", "fresh-pass-1")).ok).toBe(true);
  });

  it("changes your own password only with the current one", async () => {
    const worker = await makeUser("WORKER", { phone: "9876543213", password: "current-pass" });
    await expect(changeOwnPassword(worker, { currentPassword: "wrong", newPassword: "brand-new-pass" }))
      .rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    await expect(changeOwnPassword(worker, { currentPassword: "current-pass", newPassword: "short" })).rejects.toThrow(ValidationError);
    const claims = await changeOwnPassword(worker, { currentPassword: "current-pass", newPassword: "brand-new-pass" });
    expect(claims.sessionVersion).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: worker.userId } })).mustChangePassword).toBe(false);
  });

  it("only owners manage users", async () => {
    const worker = await makeUser("WORKER");
    await expect(listUsers(worker)).rejects.toThrow(ForbiddenError);
  });
});
