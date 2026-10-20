import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseInput, quantity, signedMoney, phone, optionalGstin } from "@/lib/validation";
import { ValidationError } from "@/lib/errors";

describe("validation", () => {
  const schema = z.object({ qty: quantity, amount: signedMoney, mobile: phone, gstin: optionalGstin });

  it("normalises valid input", () => {
    const out = parseInput(schema, { qty: "1,200", amount: -50, mobile: "+91 98765 43210", gstin: " 27aapfu0939f1zv " });
    expect(out).toEqual({ qty: "1200", amount: "-50", mobile: "9876543210", gstin: "27AAPFU0939F1ZV" });
  });

  it("treats an empty GSTIN as absent", () => {
    expect(parseInput(schema, { qty: "1", amount: "5", mobile: "9876543210", gstin: "" }).gstin).toBeUndefined();
  });

  it("throws ValidationError with a readable message and field errors", () => {
    try {
      parseInput(schema, { qty: "0", amount: "5", mobile: "9876543210" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).message).toMatch(/greater than 0/);
      expect((e as ValidationError).fieldErrors.qty?.[0]).toMatch(/greater than 0/);
    }
  });

  it("rejects more than 2 decimals and non-numbers", () => {
    expect(() => parseInput(z.object({ q: quantity }), { q: "1.005" })).toThrow(ValidationError);
    expect(() => parseInput(z.object({ q: quantity }), { q: "abc" })).toThrow(ValidationError);
  });
});
