import { describe, it, expect } from "vitest";
import { financialYearOf, financialYearShort, istDayRange, formatDateIN } from "@/lib/time";

describe("time (IST)", () => {
  it("maps mid-year dates to the FY that started in April", () => {
    expect(financialYearOf(new Date("2026-10-20T06:00:00Z"))).toBe("2026-27");
    expect(financialYearOf(new Date("2027-02-15T06:00:00Z"))).toBe("2026-27");
  });
  it("uses IST, not UTC, at the 1 April boundary", () => {
    // 2027-03-31 19:00 UTC is 2027-04-01 00:30 IST → new financial year
    expect(financialYearOf(new Date("2027-03-31T19:00:00Z"))).toBe("2027-28");
  });
  it("shortens FY labels for invoice serials", () => {
    expect(financialYearShort("2026-27")).toBe("2627");
    expect(() => financialYearShort("2026")).toThrow();
  });
  it("computes the IST calendar day as a UTC range", () => {
    const { start, end } = istDayRange(new Date("2026-10-20T10:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-19T18:30:00.000Z");
    expect(end.toISOString()).toBe("2026-10-20T18:30:00.000Z");
  });
  it("formats dates as dd-mm-yyyy in IST", () => {
    expect(formatDateIN(new Date("2026-10-19T20:00:00Z"))).toBe("20-10-2026");
  });
});
