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

test("owner makes a category, moves items into it himself, sets a size, and finds them by category", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await login(page, E2E_OWNER);
  await page.goto("/products");
  await page.waitForLoadState("networkidle");

  // Make a new category.
  await page.getByRole("button", { name: "Categories", exact: true }).click();
  await page.getByLabel("New category name").fill("ZZ TEST SECTION");
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByLabel("Name of category ZZ TEST SECTION")).toBeVisible();
  await page.keyboard.press("Escape");

  // Nothing is sorted by itself: the item starts in "Not in any category yet".
  const none = page.getByTestId("category-group").filter({ hasText: "Not in any category yet" });
  await expect(none.getByText("E2E Sort Me")).toBeVisible();

  // Pick it and move it.
  await page.getByLabel("Choose E2E Sort Me").check();
  await expect(page.getByTestId("move-bar")).toContainText("1 item(s) chosen");
  await page.getByLabel("Move chosen items to").selectOption({ label: "ZZ TEST SECTION" });
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Moved 1 item(s)")).toBeVisible();

  // It now has its own section, shown when that category is chosen.
  await page.getByLabel("Show category").selectOption({ label: "ZZ TEST SECTION (1)" });
  const section = page.getByTestId("category-group").filter({ hasText: "ZZ TEST SECTION" });
  await expect(section.getByText("E2E Sort Me")).toBeVisible();

  // Give it a size; it shows beside the name.
  await section.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Size (optional)").fill("3 x 14");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Product saved")).toBeVisible();
  await expect(section.getByTestId("size-badge")).toHaveText("Size 3 x 14");

  // The bill's item list can be narrowed to the category too.
  await page.goto("/billing/new");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Cards" }).click();
  await page.getByRole("button", { name: "Choose item…" }).click();
  await page.getByLabel("Category").selectOption({ label: "ZZ TEST SECTION" });
  const items = page.locator('[data-slot="command-list"] [role="option"]'); // not the category drop-down's own options
  await expect(items).toHaveCount(1);
  await expect(items).toContainText("size 3 x 14");

  // And the stock list.
  await page.goto("/inventory");
  await page.getByLabel("Show category").selectOption({ label: "ZZ TEST SECTION" });
  await expect(page.locator("li", { hasText: "E2E Sort Me" })).toContainText("ZZ TEST SECTION");
  await expect(page.locator("li", { hasText: "E2E Tier Candle" })).toHaveCount(0);
});

test("owner can delete an item added by mistake, but not one that has stock", async ({ page }) => {
  await login(page, E2E_OWNER);
  await page.goto("/products");
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Delete E2E Delete Me").click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByText("Deleted E2E Delete Me")).toBeVisible();
  await expect(page.getByText("E2E Delete Me")).toHaveCount(0);

  await page.getByLabel("Delete E2E Used Item").click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByText(/cannot be deleted because it is already used/)).toBeVisible();
  await expect(page.getByText("E2E Used Item").first()).toBeVisible(); // still there
});

test("the Edit product box can be scrolled and saved even on a short screen", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 520 } })).newPage();
  await login(page, E2E_OWNER);
  await page.goto("/products");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Edit" }).first().click();
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.scrollIntoViewIfNeeded(); // the box scrolls inside the screen instead of running off it
  await save.click();
  await expect(page.getByText("Product saved")).toBeVisible();
});
