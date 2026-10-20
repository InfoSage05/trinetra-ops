import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { hashPassword, verifyPassword, signSessionToken, verifySessionToken, requireRole } from "@/lib/auth";
import { ForbiddenError } from "@/lib/errors";

describe("auth primitives", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("round-trips session claims", async () => {
    const token = await signSessionToken({ userId: "u1", role: "WORKER", sessionVersion: 3 });
    expect(await verifySessionToken(token)).toEqual({ userId: "u1", role: "WORKER", sessionVersion: 3 });
  });

  it("rejects tampered tokens and tokens signed with another key", async () => {
    const token = await signSessionToken({ userId: "u1", role: "OWNER", sessionVersion: 0 });
    expect(await verifySessionToken(token.slice(0, -2) + "xx")).toBeNull();
    const forged = await new SignJWT({ role: "OWNER", sv: 0 })
      .setProtectedHeader({ alg: "HS256" }).setSubject("u1").setExpirationTime("1h")
      .sign(new TextEncoder().encode("some-other-secret-that-is-32-chars-long!!"));
    expect(await verifySessionToken(forged)).toBeNull();
  });

  it("requireRole blocks missing sessions and wrong roles", () => {
    const worker = { userId: "u1", role: "WORKER" as const, name: "W", mustChangePassword: false };
    expect(() => requireRole(null, ["OWNER", "WORKER"])).toThrow(ForbiddenError);
    expect(() => requireRole(worker, ["OWNER"])).toThrow(ForbiddenError);
    expect(() => requireRole(worker, ["OWNER", "WORKER"])).not.toThrow();
  });
});
