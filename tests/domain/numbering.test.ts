import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { allocateNumber, formatDocumentNumber } from "@/domain/numbering";
import { resetDb } from "../helpers/db";
import { makeSeries } from "../helpers/factories";

const FY = "2026-27";
const serialOf = (n: string) => Number(n.split("/")[2]);

describe("formatDocumentNumber", () => {
  it("produces Rule 46-safe serials (<=16 chars, only A-Z 0-9 /)", () => {
    const n = formatDocumentNumber("TC", FY, 1);
    expect(n).toBe("TC/2627/00001");
    expect(formatDocumentNumber("ABCD", FY, 99999)).toHaveLength(15);
    expect(n).toMatch(/^[A-Z0-9/]{1,16}$/);
  });
  it("rejects bad prefixes and exhausted series", () => {
    expect(() => formatDocumentNumber("tc", FY, 1)).toThrow();
    expect(() => formatDocumentNumber("ABCDE", FY, 1)).toThrow();
    expect(() => formatDocumentNumber("TC", FY, 100000)).toThrow(/exhausted/i);
  });
});

describe("allocateNumber", () => {
  beforeEach(resetDb);

  it("explains clearly when the series has not been set up", async () => {
    await expect(allocateNumber(prisma, "INVOICE", FY)).rejects.toMatchObject({ code: "SERIES_MISSING" });
  });

  it("allocates consecutive numbers, independently per series", async () => {
    await makeSeries("INVOICE", { financialYear: FY });
    await makeSeries("CREDIT_NOTE", { financialYear: FY });
    expect(await allocateNumber(prisma, "INVOICE", FY)).toBe("TC/2627/00001");
    expect(await allocateNumber(prisma, "INVOICE", FY)).toBe("TC/2627/00002");
    expect(await allocateNumber(prisma, "CREDIT_NOTE", FY)).toBe("CN/2627/00001");
  });

  it("does not leave a gap when the surrounding transaction rolls back", async () => {
    await makeSeries("INVOICE", { financialYear: FY });
    const first = await allocateNumber(prisma, "INVOICE", FY);
    await expect(
      prisma.$transaction(async (tx) => {
        await allocateNumber(tx, "INVOICE", FY);
        throw new Error("bill insert failed");
      })
    ).rejects.toThrow("bill insert failed");
    const next = await allocateNumber(prisma, "INVOICE", FY);
    expect(serialOf(next)).toBe(serialOf(first) + 1);
  });

  it("gives every concurrent transaction a distinct, gapless serial", async () => {
    await makeSeries("INVOICE", { financialYear: FY });
    const numbers = await Promise.all(
      Array.from({ length: 8 }, () => prisma.$transaction((tx) => allocateNumber(tx, "INVOICE", FY)))
    );
    expect(numbers.map(serialOf).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
