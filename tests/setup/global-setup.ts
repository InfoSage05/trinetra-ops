import { execSync } from "node:child_process";
import { config } from "dotenv";

export default function globalSetup() {
  const parsed = config({ path: ".env.test", override: true, quiet: true }).parsed ?? {};
  if (!parsed.DATABASE_URL?.includes("test")) {
    throw new Error(".env.test DATABASE_URL must point at a database whose name contains 'test'");
  }
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, ...parsed } });
}
