import { describe, it, expect } from "vitest";
import { describeStock, splitCartons, toPieces } from "@/lib/cartons";

describe("cartons", () => {
  it("splits pieces into whole cartons and loose pieces", () => {
    expect(splitCartons(41, 12)).toEqual({ cartons: 3, pieces: 5 });
    expect(splitCartons(36, 12)).toEqual({ cartons: 3, pieces: 0 });
    expect(splitCartons(7, 40)).toEqual({ cartons: 0, pieces: 7 });
  });
  it("treats a carton size of 1 as plain pieces", () => {
    expect(splitCartons(9, 1)).toEqual({ cartons: 9, pieces: 0 });
  });
  it("converts cartons plus loose pieces back to pieces", () => {
    expect(toPieces("3", "5", 12)).toBe("41");
    expect(toPieces("", "5", 12)).toBe("5");
    expect(toPieces("2.5", "", 12)).toBe("30");
    expect(toPieces("", "", 12)).toBe("0");
  });
  it("describes stock in words, including oversold (negative) stock", () => {
    expect(describeStock("41", 12)).toBe("3 cartons + 5 pcs (41 pcs)");
    expect(describeStock("36", 12)).toBe("3 cartons (36 pcs)");
    expect(describeStock("1", 12)).toBe("1 pcs");
    expect(describeStock("0", 12)).toBe("0 pcs");
    expect(describeStock("-14", 12)).toBe("-14 pcs (oversold)");
    expect(describeStock("50", 1)).toBe("50 pcs");
  });
});
