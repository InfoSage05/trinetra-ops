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

test("owner makes a bill in the Excel-sheet layout using only the keyboard, and the layout is remembered", async ({ browser }) => {
  // A laptop-sized window: the sheet is wide.
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await login(page, E2E_OWNER);
  await page.goto("/billing/new");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Excel sheet" }).click();
  await expect(page.getByTestId("bill-sheet")).toBeVisible();

  await page.getByRole("button", { name: "Choose customer…" }).click();
  await page.getByPlaceholder("Name, mobile or GSTIN…").fill("E2E");
  await page.getByRole("option", { name: /E2E Traders/ }).click();

  // Row 1: type part of the name, Enter picks it and jumps to cartons.
  const rows = page.getByTestId("sheet-row");
  await rows.nth(0).getByLabel("Item").fill("sheet cand");
  await expect(page.getByRole("option", { name: /E2E Sheet Candle/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(rows.nth(0).getByLabel("Cartons")).toBeFocused();
  await page.keyboard.type("2");
  await page.keyboard.press("Tab");
  await page.keyboard.type("1"); // + 1 loose piece
  await expect(rows.nth(0).getByTestId("sheet-qty-per-carton")).toHaveText("6");
  await expect(rows.nth(0).getByTestId("sheet-total-qty")).toHaveText("13");

  // Enter goes down to the next row's item cell, like a spreadsheet.
  await page.keyboard.press("Enter");
  await expect(rows.nth(1).getByLabel("Item")).toBeFocused();

  // The stock check follows the row and the server fills in the money columns.
  await expect(page.getByTestId("stock-panel")).toContainText("E2E Sheet Candle");
  await expect(rows.nth(0).getByTestId("sheet-line-total")).not.toHaveText("");
  await page.getByLabel("Freight charges").fill("50");
  await expect(page.getByTestId("sheet-grand-total")).not.toHaveText("");

  await page.getByRole("button", { name: "On credit" }).click();
  await page.getByRole("button", { name: /Save bill/ }).click();
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);

  // The choice is remembered on this device.
  await page.goto("/billing/new");
  await expect(page.getByTestId("bill-sheet")).toBeVisible();
  await page.getByRole("button", { name: "Cards" }).click();
  await expect(page.getByTestId("bill-sheet")).toHaveCount(0);
});

test("owner renames an item to something easier to remember; items without a code work everywhere", async ({ page }) => {
  await login(page, E2E_OWNER);
  await page.goto("/inventory");
  const row = page.locator("li", { hasText: "E2E Rename Me" });
  await expect(row).toBeVisible(); // no code shown, no empty brackets
  await expect(row).not.toContainText("()");
  await row.getByRole("link", { name: "E2E Rename Me" }).click();
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("New name").fill("Rose small pack");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("heading", { name: /Rose small pack/ })).toBeVisible();

  await page.goto("/inventory");
  await expect(page.locator("li", { hasText: "Rose small pack" })).toBeVisible();
  await expect(page.getByText("E2E Rename Me")).toHaveCount(0);
});

test("owner sets how many pieces make one carton, right on the stock list", async ({ page }) => {
  await login(page, E2E_OWNER);
  await page.goto("/inventory");
  await page.waitForLoadState("networkidle");
  const row = page.locator("li", { hasText: "E2E Carton Size Me" });
  await expect(row).toContainText("50 pcs"); // one piece per carton until told otherwise
  await row.getByLabel(/Pieces in one carton of E2E Carton Size Me/).fill("12");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved: 1 carton = 12 pcs")).toBeVisible();
  await expect(row).toContainText("4 cartons + 2 pcs (50 pcs)");
});
