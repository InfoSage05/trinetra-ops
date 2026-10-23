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
  await expect(rows.nth(0).getByLabel("Quantity")).toBeFocused();
  await page.keyboard.type("2"); // the unit starts as cartons: 2 cartons x 6 = 12 pieces
  await expect(rows.nth(0).getByTestId("sheet-qty-per-carton")).toHaveText("6");
  await expect(rows.nth(0).getByTestId("sheet-total-qty")).toContainText("12");
  await expect(rows.nth(0).getByTestId("sheet-cartons")).toHaveText("2");

  // The same 2 can be dozens or pieces: different dealers count in different ways.
  await page.keyboard.press("Tab");
  await expect(rows.nth(0).getByLabel("Unit")).toBeFocused();
  await rows.nth(0).getByLabel("Unit").selectOption("dozen");
  await expect(rows.nth(0).getByTestId("sheet-total-qty")).toContainText("24"); // 2 dozens
  await expect(rows.nth(0).getByTestId("sheet-cartons")).toHaveText("4");
  await rows.nth(0).getByLabel("Unit").selectOption("piece");
  await expect(rows.nth(0).getByTestId("sheet-total-qty")).toContainText("2");
  await rows.nth(0).getByLabel("Unit").selectOption("carton");
  await expect(rows.nth(0).getByTestId("sheet-total-qty")).toContainText("12");
  await rows.nth(0).getByLabel("Quantity").click();

  // Enter goes down to the next row's item cell, like a spreadsheet.
  await page.keyboard.press("Enter");
  await expect(rows.nth(1).getByLabel("Item")).toBeFocused();

  // The stock check follows the row and the server fills in the money columns.
  await expect(page.getByTestId("stock-bar")).toContainText("E2E Sheet Candle");
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

  // Stock can be corrected in cartons too: take out 1 carton (12 pieces).
  await row.getByRole("button", { name: "Correct" }).click();
  await page.getByRole("button", { name: "Take out of stock" }).click();
  await page.getByLabel("Cartons to change").fill("1");
  await expect(page.getByTestId("correction-total")).toContainText("takes out 12 pieces");
  await page.getByPlaceholder("e.g. broken, miscounted").fill("broken in the godown");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Stock corrected")).toBeVisible();
  await expect(row).toContainText("3 cartons + 2 pcs (38 pcs)");
});

test("the sheet fits the screen without sideways scrolling, can be resized, and grows up to 50 rows", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await login(page, E2E_OWNER);
  await page.goto("/billing/new");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Excel sheet" }).click();
  const frame = page.getByTestId("bill-sheet");
  await expect(frame).toBeVisible();

  // Fit to screen is on by itself: the whole width is visible.
  await page.getByRole("button", { name: "Fit to screen" }).click();
  const fits = await frame.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);

  // Bigger / smaller.
  const before = Number((await page.getByTestId("sheet-zoom").innerText()).replace("%", ""));
  await page.getByRole("button", { name: "Make the sheet bigger" }).click();
  await expect(page.getByTestId("sheet-zoom")).toHaveText(`${before + 10}%`);
  await page.getByRole("button", { name: "Make the sheet smaller" }).click();
  await page.getByRole("button", { name: "Make the sheet smaller" }).click();
  await expect(page.getByTestId("sheet-zoom")).toHaveText(`${before - 10}%`);

  // More rows, but never past the limit of 50 items.
  await expect(page.getByTestId("sheet-row")).toHaveCount(12);
  for (let i = 0; i < 9; i++) {
    const more = page.getByRole("button", { name: "Show more rows" });
    if (await more.isDisabled()) break;
    await more.click();
  }
  await expect(page.getByTestId("sheet-row")).toHaveCount(50);
  await expect(page.getByRole("button", { name: "Show more rows" })).toBeDisabled();

  // The choice is remembered, and the cards layout stops at 50 too.
  await page.reload();
  await expect(page.getByTestId("sheet-row")).toHaveCount(50);
  await page.getByRole("button", { name: "Show fewer rows" }).click();
  await expect(page.getByTestId("sheet-row")).toHaveCount(45);
  await page.getByRole("button", { name: "Fit to screen" }).click();
  await page.getByRole("button", { name: "Cards" }).click();
});
