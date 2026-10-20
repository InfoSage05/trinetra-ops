import { describe, it, expect } from "vitest";
import { D, round2, sumDecimals, roundToRupee, formatINR, amountInWords, toFixed2 } from "@/lib/money";

describe("money", () => {
  it("rounds half up to 2 dp", () => {
    expect(round2("10.005").toFixed(2)).toBe("10.01");
    expect(round2("10.004").toFixed(2)).toBe("10.00");
  });
  it("adds without floating-point drift", () => {
    expect(sumDecimals(["0.10", "0.20"]).toFixed(2)).toBe("0.30");
  });
  it("accepts Prisma-style Decimal objects via toString()", () => {
    expect(D({ toString: () => "12.50" }).toFixed(2)).toBe("12.50");
  });
  it("rounds to the nearest rupee and reports the round-off", () => {
    const a = roundToRupee("39.33");
    expect(a.rounded.toFixed(2)).toBe("39.00");
    expect(a.roundOff.toFixed(2)).toBe("-0.33");
    expect(roundToRupee("39.50").rounded.toFixed(2)).toBe("40.00");
  });
  it("formats Indian currency with lakh grouping", () => {
    expect(formatINR("123456.5")).toBe("₹1,23,456.50");
  });
  it("writes amounts in Indian words", () => {
    expect(amountInWords("1180")).toBe("One Thousand One Hundred Eighty Rupees Only");
    expect(amountInWords("123456789.50")).toBe(
      "Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Rupees and Fifty Paise Only"
    );
    expect(amountInWords("0")).toBe("Zero Rupees Only");
  });
  it("formats to a 2dp string for database writes", () => {
    expect(toFixed2("7")).toBe("7.00");
  });
});
