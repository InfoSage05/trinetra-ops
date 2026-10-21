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

test("worker types what was made; the assistant proposes it and nothing is saved until Approve", async ({ page }) => {
  await login(page, E2E_WORKER);
  await page.goto("/assistant");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("What was made").fill("orange candle 2 carton bana");
  await page.getByRole("button", { name: "Check", exact: true }).click();

  const lines = page.getByTestId("proposal-lines");
  await expect(lines.getByLabel("Item")).toHaveValue(/.+/); // matched to a real item
  await expect(lines).toContainText("= 12 pieces"); // 2 cartons x 6 per carton

  // Not saved yet.
  await page.goto("/inventory");
  await expect(page.locator("li", { hasText: "E2E Orange Candle" })).not.toContainText("12 pcs");

  await page.goto("/assistant");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("What was made").fill("orange candle 2 carton bana");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await page.getByRole("button", { name: "Approve and add to stock" }).click();
  await expect(page.getByText("Added to stock: 1 item(s).")).toBeVisible();

  await page.goto("/inventory");
  await expect(page.locator("li", { hasText: "E2E Orange Candle" })).toContainText("2 cartons (12 pcs)");
});

test("owner enters an order by text, bills it, and the order moves to delivered", async ({ page }) => {
  await login(page, E2E_OWNER);
  await page.goto("/orders/new");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("The order").fill("Order Traders, 3 carton mint, kal");
  await page.getByRole("button", { name: "Check", exact: true }).click();

  await expect(page.getByLabel("Customer")).toHaveText(/Order Traders/);
  await expect(page.getByLabel("Needed by")).not.toHaveValue("");
  await expect(page.getByTestId("proposal-lines")).toContainText("= 24 pieces"); // 3 cartons x 8
  await page.getByRole("button", { name: "Save order" }).click();
  await expect(page).toHaveURL(/\/orders\/[^/]+$/);
  await expect(page.getByText("Still to deliver: 3 cartons (24 pcs)")).toBeVisible();

  // It shows on the dashboard as due soon and in the "still to make" list.
  await page.goto("/dashboard");
  await expect(page.getByTestId("order-reminders")).toContainText("Order Traders");
  await page.goto("/orders");
  await expect(page.getByTestId("to-make")).toContainText("E2E Mint Candle");

  // Bill it: the form opens already filled in from the order.
  await page.getByRole("link", { name: /Order Traders/ }).first().click();
  await page.getByRole("link", { name: "Create bill from this order" }).click();
  await expect(page.getByTestId("purchaser-details")).toBeVisible();
  await expect(page.getByLabel("Cartons", { exact: true })).toHaveValue("3");
  await expect(page.getByText("Grand total")).toBeVisible();
  await page.getByRole("button", { name: "On credit" }).click();
  await page.getByRole("button", { name: /Save bill/ }).click();
  await expect(page.getByRole("alertdialog").getByText("Not enough stock")).toBeVisible(); // only 1 carton in stock
  await page.getByRole("button", { name: "Bill anyway" }).click();
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);

  await page.goto("/orders?show=ALL");
  await page.getByRole("link", { name: /Order Traders/ }).first().click();
  await expect(page.getByText("Delivered: 3 cartons (24 pcs)")).toBeVisible();
});
