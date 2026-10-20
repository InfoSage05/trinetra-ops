import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { runAction, toPlain } from "@/lib/action-result";
import { DomainError, ValidationError } from "@/lib/errors";

describe("toPlain", () => {
  it("turns Prisma Decimals into strings at any depth and keeps Dates", () => {
    const when = new Date("2026-10-20T00:00:00Z");
    const plain = toPlain({ a: new Prisma.Decimal("13.50"), list: [{ b: new Prisma.Decimal("2") }], when, n: 3, s: "x", nil: null });
    expect(plain).toEqual({ a: "13.5", list: [{ b: "2" }], when, n: 3, s: "x", nil: null });
  });
});

describe("runAction", () => {
  it("wraps success", async () => {
    expect(await runAction(async () => ({ total: new Prisma.Decimal("10") }))).toEqual({ ok: true, data: { total: "10" } });
  });
  it("returns domain errors as readable results", async () => {
    const result = await runAction(async () => { throw new DomainError("SHORTFALL_NOT_CONFIRMED", "Confirm the shortfall first."); });
    expect(result).toEqual({ ok: false, code: "SHORTFALL_NOT_CONFIRMED", error: "Confirm the shortfall first." });
  });
  it("includes field errors for validation failures", async () => {
    const result = await runAction(async () => { throw new ValidationError("Bad qty", { qty: ["Bad qty"] }); });
    expect(result).toEqual({ ok: false, code: "VALIDATION", error: "Bad qty", fieldErrors: { qty: ["Bad qty"] } });
  });
  it("hides unexpected errors behind a friendly message and logs them", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runAction(async () => { throw new Error("connection reset"); });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNEXPECTED");
      expect(result.error).not.toMatch(/connection reset/);
    }
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
