import { execSync } from "node:child_process";
import { config } from "dotenv";

export const E2E_OWNER = { phone: "9811111111", password: "e2e-owner-pass" };
export const E2E_WORKER = { phone: "9822222222", password: "e2e-worker-pass" };

export default async function globalSetup() {
  const env = config({ path: ".env.test", override: true, quiet: true }).parsed ?? {};
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, ...env } });

  const { resetDb } = await import("../helpers/db");
  const f = await import("../helpers/factories");
  const { prisma } = await import("../../src/lib/db");

  await resetDb();
  await f.makeBusinessProfile();
  await f.makeSeries("INVOICE");
  await f.makeSeries("CREDIT_NOTE");
  await f.makeUser("OWNER", { name: "E2E Owner", ...E2E_OWNER });
  await f.makeUser("WORKER", { name: "E2E Worker", ...E2E_WORKER });
  await f.makeCustomer({ name: "E2E Traders" });
  const product = await f.makeProduct({ sku: "E2E-1", name: "E2E Lavender Candle" });
  await f.addStock(product.id, "20.00");
  await prisma.$disconnect();
}
