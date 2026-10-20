import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { isUniqueConstraintError } from "@/lib/prisma-errors";
import { resetDb } from "../helpers/db";

describe("isUniqueConstraintError", () => {
  beforeEach(resetDb);

  it("recognises a real unique violation from the database", async () => {
    await prisma.user.create({ data: { name: "A", phone: "9000000009", passwordHash: "x", role: "OWNER" } });
    const error = await prisma.user
      .create({ data: { name: "B", phone: "9000000009", passwordHash: "x", role: "OWNER" } })
      .catch((e: unknown) => e);
    expect(isUniqueConstraintError(error)).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isUniqueConstraintError(new Error("timeout"))).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
  });
});
