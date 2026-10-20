import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { saveBusinessProfile, requireBusinessProfile, ensureNumberSeries, getNumberSeriesStatus } from "@/domain/settings";
import { allocateNumber } from "@/domain/numbering";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { financialYearOf } from "@/lib/time";
import { resetDb } from "../helpers/db";
import { makeUser, BUSINESS_GSTIN } from "../helpers/factories";

const profileInput = {
  legalName: "Trinetra Candles", gstin: BUSINESS_GSTIN.toLowerCase(), addressLine1: "Plot 12, Industrial Estate",
  city: "Cuttack", pincode: "753001", phone: "9437000000", upiId: "trinetra@upi",
};

describe("settings", () => {
  beforeEach(resetDb);

  it("tells the user to finish setup before billing", async () => {
    await expect(requireBusinessProfile(prisma)).rejects.toMatchObject({ code: "SETUP_INCOMPLETE" });
  });

  it("saves the profile, normalising the GSTIN and deriving the state", async () => {
    const owner = await makeUser("OWNER");
    const saved = await saveBusinessProfile(owner, profileInput);
    expect(saved.gstin).toBe(BUSINESS_GSTIN);
    expect(saved.stateCode).toBe("21");
    expect((await requireBusinessProfile(prisma)).legalName).toBe("Trinetra Candles");
  });

  it("rejects an invalid GSTIN and non-owners", async () => {
    const owner = await makeUser("OWNER");
    const worker = await makeUser("WORKER");
    await expect(saveBusinessProfile(owner, { ...profileInput, gstin: "21AAAAA0000A1ZX" })).rejects.toThrow(ValidationError);
    await expect(saveBusinessProfile(worker, profileInput)).rejects.toThrow(ForbiddenError);
  });

  it("creates number series idempotently and locks the prefix once used", async () => {
    const owner = await makeUser("OWNER");
    const fy = financialYearOf();
    await ensureNumberSeries(owner, { series: "INVOICE", prefix: "TC" });
    await ensureNumberSeries(owner, { series: "INVOICE", prefix: "TCX" }); // unused yet → prefix may change
    expect((await getNumberSeriesStatus(prisma)).find((s) => s.series === "INVOICE")).toMatchObject({ exists: true, prefix: "TCX" });

    await allocateNumber(prisma, "INVOICE", fy);
    await expect(ensureNumberSeries(owner, { series: "INVOICE", prefix: "TC" })).rejects.toMatchObject({ code: "SERIES_IN_USE" });
    expect((await getNumberSeriesStatus(prisma)).find((s) => s.series === "CREDIT_NOTE")?.exists).toBe(false);
  });
});
