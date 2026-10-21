import { test, expect, type Page } from "@playwright/test";
import { E2E_OWNER, E2E_WORKER } from "./global-setup";

async function login(page: Page, who: { phone: string; password: string }) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle"); // let React hydrate before interacting
  await page.getByLabel("Mobile number").fill(who.phone);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("owner sees reports and downloads the GST exports; a worker cannot", async ({ browser }) => {
  const owner = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
  await login(owner, E2E_OWNER);
  await owner.goto("/reports");
  await expect(owner.getByTestId("sales-summary")).toContainText("Net sales");
  await expect(owner.getByTestId("dues-ageing")).toContainText("Money to collect");

  const today = new Date().toISOString().slice(0, 10);
  const range = `from=${today}&to=${today}`;
  const register = await owner.request.get(`/api/reports/sales-register?${range}`);
  expect(register.status()).toBe(200);
  expect(register.headers()["content-type"]).toContain("text/csv");
  expect(await register.text()).toContain("Taxable value");
  expect((await owner.request.get("/api/reports/hsn-summary?from=2020-01-01&to=2020-01-31")).status()).toBe(400); // nothing to export
  expect((await owner.request.get("/api/reports/nope?from=2020-01-01&to=2020-01-31")).status()).toBe(404);

  expect((await owner.request.get("/api/reports/toString?from=2020-01-01&to=2020-01-31")).status()).toBe(404); // only real report names

  const worker = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
  await login(worker, E2E_WORKER);
  expect((await worker.request.get(`/api/reports/sales-register?${range}`)).status()).toBe(403);
});
