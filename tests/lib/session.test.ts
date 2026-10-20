import { describe, it, expect, beforeEach, vi } from "vitest";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { signSessionToken } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { resetDb } from "../helpers/db";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

function withCookie(token: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === "tc_session" && token ? { name, value: token } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

describe("getSession", () => {
  beforeEach(resetDb);

  it("returns the session for an active user with a matching session version", async () => {
    const user = await prisma.user.create({ data: { name: "Owner", phone: "9000000001", passwordHash: "x", role: "OWNER" } });
    withCookie(await signSessionToken({ userId: user.id, role: "OWNER", sessionVersion: 0 }));
    expect(await getSession()).toEqual({ userId: user.id, role: "OWNER", name: "Owner", mustChangePassword: false });
  });

  it("returns null when there is no cookie", async () => {
    withCookie(undefined);
    expect(await getSession()).toBeNull();
  });

  it("returns null after the user is deactivated or their session version changes", async () => {
    const user = await prisma.user.create({ data: { name: "Worker", phone: "9000000002", passwordHash: "x", role: "WORKER" } });
    withCookie(await signSessionToken({ userId: user.id, role: "WORKER", sessionVersion: 0 }));

    await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: 1 } });
    expect(await getSession()).toBeNull();
  });
});
