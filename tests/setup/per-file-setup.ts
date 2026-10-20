import { config } from "dotenv";
import { afterAll, vi } from "vitest";

config({ path: ".env.test", override: true, quiet: true });

// Next.js-only modules that cannot run under Vitest.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

afterAll(async () => {
  const { prisma } = await import("@/lib/db");
  await prisma.$disconnect();
});
