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
  await page.keyboard.type("2"); // the unit starts as patty: 2 patty = 60 pieces
  await expect(rows.nth(0).getByLabel("Unit")).toHaveValue("patty");
  await expect(rows.nth(0).getByTestId("sheet-total-qty")).toContainText("60");

  // The same 2 can be dozens or pieces: different dealers count in different ways.
  await rows.nth(0).getByLabel("Unit").selectOption("dozen");
  await expect(rows.nth(0).getByTestId("sheet-total-qty")).toContainText("24"); // 2 dozens
  await rows.nth(0).getByLabel("Unit").selectOption("piece");
  await expect(rows.nth(0).getByTestId("sheet-total-qty")).toContainText("2");

  // Cartons and patty-per-carton can be typed by hand. This item's carton is 30 patty (900 pieces).
  await expect(rows.nth(0).getByLabel("Patty per carton")).toHaveAttribute("placeholder", "30");
  await rows.nth(0).getByLabel("Cartons").fill("2"); // 2 cartons x 30 patty = 60 patty = 1800 pieces
  await expect(rows.nth(0).getByLabel("Unit")).toHaveValue("patty");
  await expect(rows.nth(0).getByLabel("Quantity")).toHaveValue("60");
  await expect(rows.nth(0).getByTestId("sheet-total-qty")).toContainText(/1,?800/);
  await rows.nth(0).getByLabel("Patty per carton").fill("20"); // this bill's cartons hold 20 patty: still 2 cartons
  await expect(rows.nth(0).getByLabel("Quantity")).toHaveValue("40");
  await expect(rows.nth(0).getByTestId("sheet-total-qty")).toContainText(/1,?200/);
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

test("amounts without and with GST appear as soon as quantity and rate are filled, even before a customer is chosen", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await login(page, E2E_OWNER);
  await page.goto("/billing/new");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Excel sheet" }).click();
  const row = page.getByTestId("sheet-row").nth(0);
  await row.getByLabel("Item").fill("sheet cand");
  await page.keyboard.press("Enter");
  await page.keyboard.type("2"); // 2 patty = 60 pieces
  await page.keyboard.press("Tab");
  // The sheet no longer has discount or CGST/SGST/IGST columns, just the two amounts.
  await expect(page.getByRole("columnheader", { name: "Amount without GST" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Amount with GST" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Discount|CGST|SGST|IGST/ })).toHaveCount(0);

  const rate = Number((await row.getByLabel("Rate", { exact: true }).getAttribute("placeholder"))!.replace(/,/g, ""));
  const ex = 60 * rate;
  await expect(row.getByTestId("sheet-amount-ex")).toHaveText(ex.toLocaleString("en-IN", { minimumFractionDigits: 2 }));
  const gst = Number((await row.getByTestId("sheet-gst-rate").innerText()).replace("%", ""));
  await expect(row.getByTestId("sheet-line-total")).toHaveText((ex + Math.round(ex * gst) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 }));
  await expect(page.getByTestId("sheet-total-ex")).not.toHaveText("");

  // Typing an own rate updates both amounts at once: 60 pieces at 25 = 1500 before GST.
  await row.getByLabel("Rate", { exact: true }).fill("25");
  await expect(row.getByTestId("sheet-amount-ex")).toHaveText("1,500.00");
  await page.getByRole("button", { name: "Cards" }).click();
});

test("a half-filled bill is kept when you change tab and come back, and cleared when you start a new bill", async ({ page }) => {
  await login(page, E2E_OWNER);
  await page.goto("/billing/new");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Cards" }).click();
  await page.getByRole("button", { name: "Choose customer…" }).click();
  await page.getByPlaceholder("Name, mobile or GSTIN…").fill("E2E");
  await page.getByRole("option", { name: /E2E Traders/ }).click();
  await page.getByRole("button", { name: "Choose item…" }).click();
  await page.getByRole("option", { name: /E2E Sheet Candle/ }).click();
  await page.getByLabel("Quantity", { exact: true }).fill("7");
  await page.getByLabel("Rate", { exact: true }).fill("33");
  await page.waitForTimeout(700); // saved a moment after the last change

  await page.getByRole("link", { name: "Home" }).click(); // go to another tab...
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole("link", { name: "New bill", exact: true }).first().click(); // ...and come back
  await expect(page.getByTestId("draft-restored")).toBeVisible();
  await expect(page.getByRole("button", { name: "E2E Traders" })).toBeVisible();
  await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("7");
  await expect(page.getByLabel("Rate", { exact: true })).toHaveValue("33");

  await page.getByRole("button", { name: "Start a new bill" }).click();
  await expect(page.getByTestId("draft-restored")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Choose customer…" })).toBeVisible();
});

test("any column of the sheet can be made wider or narrower by dragging its heading edge, like Excel", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await login(page, E2E_OWNER);
  await page.goto("/billing/new");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Excel sheet" }).click();
  await page.getByRole("button", { name: "Fit to screen" }).click();
  await page.getByRole("button", { name: "Make the sheet smaller" }).click(); // leave room to grow

  const heading = page.getByRole("columnheader", { name: /Description of goods/ });
  const before = (await heading.boundingBox())!.width;
  const handle = page.getByTestId("col-handle-1");
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await heading.boundingBox())!.width).toBeGreaterThan(before + 60);

  // It is remembered after a reload; double-click the edge (or the button) to go back to the standard widths.
  await page.reload();
  await expect.poll(async () => (await page.getByRole("columnheader", { name: /Description of goods/ }).boundingBox())!.width).toBeGreaterThan(before + 60);
  await page.getByRole("button", { name: "Reset column widths" }).click();
  await expect.poll(async () => Math.abs((await page.getByRole("columnheader", { name: /Description of goods/ }).boundingBox())!.width - before)).toBeLessThan(2);
  await page.getByRole("button", { name: "Cards" }).click();
});
