import { describe, it, expect } from "vitest";
import { computeLine, computeTotals, isInterState, taxOnTaxableValue } from "@/domain/tax";
import { ValidationError } from "@/lib/errors";

const s = (d: { toFixed(n: number): string }) => d.toFixed(2);

describe("tax engine", () => {
  it("splits intra-state tax into equal CGST and SGST", () => {
    const line = computeLine({ quantity: "10", unitPrice: "150", gstRate: "18" }, false);
    expect([s(line.taxableValue), s(line.cgstAmount), s(line.sgstAmount), s(line.igstAmount), s(line.lineTotal)])
      .toEqual(["1500.00", "135.00", "135.00", "0.00", "1770.00"]);
  });

  it("charges only IGST for inter-state supply", () => {
    expect(isInterState("21", "27")).toBe(true);
    const line = computeLine({ quantity: "10", unitPrice: "150", gstRate: "18" }, true);
    expect([s(line.cgstAmount), s(line.igstAmount)]).toEqual(["0.00", "270.00"]);
  });

  it("taxes the value after discount", () => {
    const line = computeLine({ quantity: "10", unitPrice: "150", discountAmount: "100", gstRate: "18" }, false);
    expect([s(line.grossAmount), s(line.taxableValue), s(line.cgstAmount), s(line.lineTotal)])
      .toEqual(["1500.00", "1400.00", "126.00", "1652.00"]);
  });

  it("rejects a discount larger than the line amount", () => {
    expect(() => computeLine({ quantity: "1", unitPrice: "10", discountAmount: "11", gstRate: "18" }, false)).toThrow(ValidationError);
  });

  it("rounds each tax component half-up to the paisa", () => {
    const t = taxOnTaxableValue("33.33", "18", false); // 33.33 x 9% = 2.9997
    expect([s(t.cgstAmount), s(t.sgstAmount)]).toEqual(["3.00", "3.00"]);
  });

  it("totals exactly equal the sum of lines, and round the grand total to the rupee", () => {
    const lines = [
      computeLine({ quantity: "1", unitPrice: "33.33", gstRate: "18" }, false), // tax 6.00
      computeLine({ quantity: "1", unitPrice: "19.99", gstRate: "12" }, false), // tax 1.20 + 1.20
    ];
    const t = computeTotals(lines);
    expect([s(t.taxableTotal), s(t.taxTotal), s(t.roundOff), s(t.grandTotal)]).toEqual(["53.32", "8.40", "0.28", "62.00"]);
    expect(s(t.cgstTotal.plus(t.sgstTotal).plus(t.igstTotal))).toBe(s(t.taxTotal));
    expect(s(t.taxableTotal.plus(t.taxTotal).plus(t.roundOff))).toBe(s(t.grandTotal));
  });
});
