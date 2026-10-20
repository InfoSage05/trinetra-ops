import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations need a direct (non-pooled) connection in production; locally both are the same.
// A placeholder keeps `prisma generate` (which never connects) working in CI before env is set.
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://unset:unset@localhost:5432/unset";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: { url },
});
