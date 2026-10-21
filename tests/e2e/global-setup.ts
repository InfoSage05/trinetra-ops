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
  // Each item packs a different number of pieces per carton, like the real catalogue.
  const product = await f.makeProduct({ sku: "E2E-1", name: "E2E Lavender Candle", qtyPerCarton: 10 });
  await f.addStock(product.id, "20.00");
  const rose = await f.makeProduct({ sku: "E2E-2", name: "E2E Rose Candle", qtyPerCarton: 4 });
  await f.addStock(rose.id, "5.00");
  const jasmine = await f.makeProduct({ sku: "E2E-3", name: "E2E Jasmine Candle" });
  await f.addStock(jasmine.id, "20.00");
  await f.makeProduct({ sku: "E2E-4", name: "E2E Orange Candle", qtyPerCarton: 6 });
  const mint = await f.makeProduct({ sku: "E2E-5", name: "E2E Mint Candle", qtyPerCarton: 8 });
  await f.addStock(mint.id, "8.00");
  await f.makeCustomer({ name: "Flow Traders" });
  await f.makeCustomer({ name: "Order Traders" });
  await prisma.$disconnect();

  // Warm the dev server so the first test is not racing route compilation.
  for (const path of ["/login", "/api/health"]) await fetch(`http://localhost:3100${path}`).catch(() => undefined);
}
