import { describe, it, expect, beforeEach, vi } from "vitest";
import { getSession, setSessionCookie } from "@/lib/session";
import { loginAction, changePasswordAction } from "@/actions/auth";
import { resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

vi.mock("@/lib/session", () => ({ getSession: vi.fn(), setSessionCookie: vi.fn(), clearSessionCookie: vi.fn() }));

describe("auth actions", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(setSessionCookie).mockClear();
  });

  it("logs in and sets the cookie; reports a friendly error otherwise", async () => {
    await makeUser("WORKER", { phone: "9876543210", password: "secret-pass-1" });
    expect(await loginAction({ phone: "9876543210", password: "nope" })).toEqual({ ok: false, code: "LOGIN_FAILED", error: "Wrong phone number or password." });
    expect(setSessionCookie).not.toHaveBeenCalled();

    expect(await loginAction({ phone: "9876543210", password: "secret-pass-1" })).toEqual({ ok: true, data: { role: "WORKER" } });
    expect(setSessionCookie).toHaveBeenCalledTimes(1);
  });

  it("changes the password and re-issues the session cookie", async () => {
    const worker = await makeUser("WORKER", { phone: "9876543219", password: "current-pass" });
    vi.mocked(getSession).mockResolvedValue(worker);
    const result = await changePasswordAction({ currentPassword: "current-pass", newPassword: "brand-new-pass" });
    expect(result).toEqual({ ok: true, data: { changed: true } });
    expect(setSessionCookie).toHaveBeenCalledWith(expect.objectContaining({ userId: worker.userId, sessionVersion: 1 }));
  });
});
