import { test, expect, type Page } from "@playwright/test";
import { E2E_OWNER } from "./global-setup";

async function login(page: Page, who: { phone: string; password: string }) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle"); // let React hydrate before interacting
  await page.getByLabel("Mobile number").fill(who.phone);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("a saved bill puts a PDF copy on the device, and a test bill can be deleted so its number is used again", async ({ page }) => {
  await login(page, E2E_OWNER);
  await page.goto("/billing/new");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Cards" }).click();
  await page.getByRole("button", { name: "Choose customer…" }).click();
  await page.getByPlaceholder("Name, mobile or GSTIN…").fill("Order");
  await page.getByRole("option", { name: /Order Traders/ }).click();
  await page.getByRole("button", { name: "Choose item…" }).click();
  await page.getByRole("option", { name: /E2E Tier Candle/ }).click();
  await page.getByLabel("Unit", { exact: true }).selectOption("piece");
  await page.getByLabel("Quantity", { exact: true }).fill("1");
  await expect(page.getByText("Grand total")).toBeVisible();

  // Saving also stores a PDF on this device.
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.getByRole("button", { name: /Save bill/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^TC-\d{4}-\d{5}\.pdf$/);
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);
  const invoice = (await page.getByRole("heading", { name: /TC\/\d{4}\/\d{5}/ }).first().innerText()).trim();

  // Delete it as a test bill.
  await page.getByRole("button", { name: `Delete bill ${invoice}` }).click();
  const confirm = page.getByRole("button", { name: "Delete this bill" });
  await expect(confirm).toBeDisabled(); // not until it is confirmed as a test
  await page.getByLabel("This bill was only made for testing.").check();
  await confirm.click();
  await expect(page.getByText(new RegExp(`Bill ${invoice.replaceAll("/", "\\/")} deleted. The next bill will be ${invoice.replaceAll("/", "\\/")}`))).toBeVisible();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(page.getByText(invoice)).toHaveCount(0);
});
