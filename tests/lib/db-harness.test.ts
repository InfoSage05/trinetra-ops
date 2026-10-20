import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb, assertTestDatabase } from "../helpers/db";

describe("test harness", () => {
  beforeEach(resetDb);

  it("connects to the test database, not the dev database", async () => {
    const rows = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    expect(rows[0].db).toBe("trinetra_test");
  });

  it("refuses to reset a non-test database", () => {
    expect(() => assertTestDatabase("postgresql://u:p@localhost:5433/trinetra_dev")).toThrow(/Refusing/);
    expect(() => assertTestDatabase("postgresql://u:p@localhost:5433/trinetra_test")).not.toThrow();
  });
});
