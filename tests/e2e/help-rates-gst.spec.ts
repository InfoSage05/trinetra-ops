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

test("the Help button is on every page and answers in simple steps with a link", async ({ page }) => {
  await login(page, E2E_OWNER);
  for (const path of ["/dashboard", "/inventory", "/products"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Open help" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Open help" }).click();
  await page.getByRole("button", { name: "How do I change the rate of an item?" }).click();
  await expect(page.getByTestId("help-answer")).toContainText("Rates and names");
  await page.getByRole("link", { name: "Open Products" }).click();
  await expect(page).toHaveURL(/\/products/);
});

test("a worker's Help only offers worker pages", async ({ page }) => {
  await login(page, E2E_WORKER);
  await page.getByRole("button", { name: "Open help" }).click();
  await expect(page.getByRole("button", { name: "How do I make a bill?" })).toHaveCount(0);
  await page.getByRole("button", { name: "How do I count the stock?" }).click();
  await expect(page.getByTestId("help-answer")).toContainText("Count stock");
});

test("owner changes an item's rate and name from the Rates and names table", async ({ page }) => {
  await login(page, E2E_OWNER);
  await page.goto("/products");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Rates and names" }).click();
  await page.getByLabel("Rate of E2E Rate Me", { exact: true }).fill("175.50");
  await page.getByLabel("Name of E2E Rate Me", { exact: true }).fill("E2E Rate Me Big");
  await page.locator("li", { has: page.getByLabel("Rate of E2E Rate Me", { exact: true }) }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Rates and names" }).click();
  await expect(page.getByLabel("Rate of E2E Rate Me Big")).toHaveValue("175.50");
});

test("GST rates are visible while making a bill, in both layouts", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await login(page, E2E_OWNER);
  await page.goto("/billing/new");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Cards" }).click();
  await page.getByRole("button", { name: "Choose customer…" }).click();
  await page.getByPlaceholder("Name, mobile or GSTIN…").fill("E2E");
  await page.getByRole("option", { name: /E2E Traders/ }).click();
  await page.getByRole("button", { name: "Choose item…" }).click();
  await page.getByRole("option", { name: /E2E Mint Candle/ }).click();
  await expect(page.getByText("GST 18%").first()).toBeVisible(); // beside the item in the card
  await page.getByLabel("Cartons", { exact: true }).fill("1");
  await expect(page.getByTestId("gst-rate-row").first()).toContainText("18%");

  await page.getByRole("button", { name: "Excel sheet" }).click();
  await expect(page.getByTestId("sheet-gst-rate").first()).toHaveText("18%");
  await expect(page.getByTestId("gst-summary")).toContainText("GST rates on this bill");
  await page.getByRole("button", { name: "Cards" }).click(); // leave the saved preference as found
});

test("the order screen offers Insert images (or says why photo reading is off)", async ({ page }) => {
  await login(page, E2E_OWNER);
  await page.goto("/orders/new");
  await expect(page.getByText("Upload a photo of the order")).toBeVisible();
  // The test server has no vision model, so it explains instead of showing a broken button.
  await expect(page.getByText("Photo reading is not switched on yet")).toBeVisible();
});
