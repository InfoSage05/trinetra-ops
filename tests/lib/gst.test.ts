import { describe, it, expect } from "vitest";
import { isValidGstin, gstinCheckCharacter, stateCodeFromGstin, isValidStateCode, stateName, isValidHsn } from "@/lib/gst";

describe("gst", () => {
  it("computes the GSTIN check character (mod-36)", () => {
    expect(gstinCheckCharacter("27AAPFU0939F1Z")).toBe("V");
    expect(gstinCheckCharacter("21AAAAA0000A1Z")).toBe("E");
    expect(gstinCheckCharacter("21BBBBB1111B1Z")).toBe("Z");
  });
  it("validates GSTIN format and checksum", () => {
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin("27AAPFU0939F1ZW")).toBe(false);
    expect(isValidGstin("27AAPFU0939F1V")).toBe(false);
    expect(isValidGstin("99AAPFU0939F1ZV")).toBe(false);
  });
  it("derives the state from a GSTIN", () => {
    expect(stateCodeFromGstin("21AAAAA0000A1ZE")).toBe("21");
    expect(stateName("21")).toBe("Odisha");
    expect(isValidStateCode("27")).toBe(true);
    expect(isValidStateCode("XX")).toBe(false);
  });
  it("accepts 4, 6 or 8 digit HSN codes only", () => {
    expect(isValidHsn("3406")).toBe(true);
    expect(isValidHsn("340600")).toBe(true);
    expect(isValidHsn("34060010")).toBe(true);
    expect(isValidHsn("34060")).toBe(false);
    expect(isValidHsn("ABCD")).toBe(false);
  });
});
