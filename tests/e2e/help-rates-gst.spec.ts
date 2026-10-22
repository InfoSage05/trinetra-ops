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
  await page.getByLabel("Rate B of E2E Rate Me", { exact: true }).fill("175.50");
  await page.getByLabel("Rate A of E2E Rate Me", { exact: true }).fill("150");
  await page.getByLabel("Rate C of E2E Rate Me", { exact: true }).fill("210");
  await page.getByLabel("Name of E2E Rate Me", { exact: true }).fill("E2E Rate Me Big");
  await page.locator("li", { has: page.getByLabel("Rate B of E2E Rate Me", { exact: true }) }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Rates and names" }).click();
  await expect(page.getByLabel("Rate B of E2E Rate Me Big")).toHaveValue("175.50");
  await expect(page.getByLabel("Rate A of E2E Rate Me Big")).toHaveValue("150.00");
  await expect(page.getByLabel("Rate C of E2E Rate Me Big")).toHaveValue("210.00");
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
  await page.getByLabel("Quantity", { exact: true }).fill("1");
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

test("owner can set the same GST rate on every item from Products", async ({ page }) => {
  await login(page, E2E_OWNER);
  await page.goto("/products");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Set GST for all items" }).click();
  await expect(page.getByLabel("GST % for every item")).toHaveValue("5");
  await page.getByRole("button", { name: "Change GST for all items" }).click();
  await expect(page.getByText(/GST set to 5.00% on \d+ item|already has 5.00% GST/)).toBeVisible();
  await expect(page.getByText("GST 18%")).toHaveCount(0);
});

test("the bill starts at the customer's rate type, and it can be switched between Rate A, B and C", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await login(page, E2E_OWNER);
  await page.goto("/billing/new");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Cards" }).click();
  await page.getByRole("button", { name: "Choose customer…" }).click();
  await page.getByPlaceholder("Name, mobile or GSTIN…").fill("Tier");
  await page.getByRole("option", { name: /Tier Traders/ }).click();
  const group = page.getByTestId("rate-tier");
  await expect(group.getByRole("button", { name: /Rate C/ })).toHaveAttribute("aria-pressed", "true"); // this customer is a direct vendor

  await page.getByRole("button", { name: "Choose item…" }).click();
  await page.getByRole("option", { name: /E2E Tier Candle/ }).click();
  await expect(page.getByLabel("Rate", { exact: true })).toHaveAttribute("placeholder", "130");
  await group.getByRole("button", { name: /Rate A/ }).click();
  await expect(page.getByLabel("Rate", { exact: true })).toHaveAttribute("placeholder", "80");
  await group.getByRole("button", { name: /Rate B/ }).click();
  await expect(page.getByLabel("Rate", { exact: true })).toHaveAttribute("placeholder", "100");

  // Each line can also pick any of the item's three rates, or an own rate, from its own drop-down.
  const choice = page.getByLabel("Rate choice");
  await choice.selectOption("C");
  await expect(page.getByLabel("Rate", { exact: true })).toHaveAttribute("placeholder", "130");
  await choice.selectOption("custom");
  await expect(page.getByLabel("Rate", { exact: true })).toHaveValue("130"); // starts from the rate it was on
  await page.getByLabel("Rate", { exact: true }).fill("95");
  await expect(choice).toHaveValue("custom");
  await page.getByLabel("Rate", { exact: true }).fill("");
  await choice.selectOption("bill");

  // The server's total uses the chosen rate: 10 pieces at Rate A = 800 before GST.
  await group.getByRole("button", { name: /Rate A/ }).click();
  await page.getByLabel("Unit", { exact: true }).selectOption("piece");
  await page.getByLabel("Quantity", { exact: true }).fill("10");
  await expect(page.getByTestId("gst-rate-row").first()).toContainText("800");
});

test("owner raises every rate by a percentage when the wax price goes up", async ({ page }) => {
  await login(page, E2E_OWNER);
  await page.goto("/products");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Change all rates by %" }).click();
  await page.getByLabel("Percent change").fill("10");
  await page.getByRole("button", { name: "Change the rates" }).click();
  await expect(page.getByText(/Rates changed by 10% on \d+ item/)).toBeVisible();
  await page.getByRole("button", { name: "Rates and names" }).click();
  await expect(page.getByLabel("Rate B of E2E Tier Candle")).toHaveValue("110.00");
  await expect(page.getByLabel("Rate A of E2E Tier Candle")).toHaveValue("88.00");
  await expect(page.getByLabel("Rate C of E2E Tier Candle")).toHaveValue("143.00");
});

test("rates show a carton rate and a piece rate side by side, and either can be typed", async ({ page }) => {
  await login(page, E2E_OWNER);
  await page.goto("/products");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Rates and names" }).click();
  const piece = Number(await page.getByLabel("Rate B of E2E Sheet Candle", { exact: true }).inputValue());
  await expect(page.getByLabel("Per carton B for E2E Sheet Candle")).toHaveValue((piece * 6).toFixed(2)); // 6 pieces per carton
  await page.getByLabel("Per carton B for E2E Sheet Candle").fill("600");
  await expect(page.getByLabel("Rate B of E2E Sheet Candle", { exact: true })).toHaveValue("100.00"); // 600 / 6
  await page.locator("li", { has: page.getByLabel("Per carton B for E2E Sheet Candle") }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Rates and names" }).click();
  await expect(page.getByLabel("Per carton B for E2E Sheet Candle")).toHaveValue("600.00");
});
