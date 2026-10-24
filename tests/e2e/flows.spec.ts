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

test("overselling asks for confirmation, then payment and a return work on the bill", async ({ page }) => {
  await login(page, E2E_OWNER);
  await page.goto("/billing/new");

  await page.getByRole("button", { name: "Choose customer…" }).click();
  await page.getByPlaceholder("Name, mobile or GSTIN…").fill("Flow");
  await page.getByRole("option", { name: /Flow Traders/ }).click();

  await page.getByRole("button", { name: "Choose item…" }).click();
  await page.getByRole("option", { name: /E2E Rose Candle/ }).click();
  await page.getByLabel("Unit", { exact: true }).selectOption("piece");
  await page.getByLabel("Quantity", { exact: true }).fill("8"); // 8 pieces, only 5 in stock
  await expect(page.getByTestId("stock-bar")).toContainText("Short by 3 pcs");
  await expect(page.getByText("Grand total")).toBeVisible(); // the server's total has arrived

  // Pay on credit, so a payment can be recorded afterwards.
  await page.getByRole("button", { name: "On credit" }).click();
  await page.getByRole("button", { name: /Save bill/ }).click();
  await expect(page.getByRole("alertdialog").getByText("Not enough stock")).toBeVisible();
  await page.getByRole("button", { name: "Bill anyway" }).click();
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);

  // Record a part payment.
  await page.getByRole("button", { name: "Record payment" }).click();
  await page.getByRole("dialog").getByRole("textbox").first().fill("500");
  await page.getByRole("button", { name: "Save payment" }).click();
  await expect(page.getByText("Payment recorded")).toBeVisible();
  await expect(page.getByText(/Due ₹/).first()).toBeVisible();

  // Return one item (not restocked) and see the credit note appear.
  await page.getByRole("button", { name: "Return items" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").first().fill("1");
  await dialog.getByPlaceholder("e.g. broken in transit").fill("broken in transit");
  await dialog.getByRole("checkbox").click(); // untick "put back into stock"
  await dialog.getByRole("button", { name: "Create credit note" }).click();
  await expect(page.getByText("Credit note created")).toBeVisible();
  await expect(page.getByText(/Credit notes: CN\//)).toBeVisible();
});

test("worker records production and a count; owner approves the count", async ({ browser }) => {
  const workerPage = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
  await login(workerPage, E2E_WORKER);
  await workerPage.goto("/inventory");
  const row = workerPage.locator("li", { hasText: "E2E Jasmine Candle" });
  await row.getByRole("button", { name: "+ Made" }).click();
  await workerPage.getByLabel("Extra pieces").fill("10");
  await workerPage.getByRole("button", { name: "Save", exact: true }).click();
  await expect(workerPage.getByText("Production added")).toBeVisible();
  await expect(workerPage.getByRole("button", { name: "Correct" })).toHaveCount(0); // owner-only

  await workerPage.goto("/inventory/counts");
  await workerPage.locator("#item").selectOption({ label: "E2E Jasmine Candle (E2E-3)" });
  await workerPage.locator("#looseCounted").fill("25");
  await workerPage.getByRole("button", { name: "Save count" }).click();
  await expect(workerPage.getByText("Count sent to the owner")).toBeVisible();

  const ownerPage = await (await browser.newContext({ viewport: { width: 412, height: 915 } })).newPage();
  await login(ownerPage, E2E_OWNER);
  await ownerPage.goto("/inventory/counts");
  await expect(ownerPage.getByText(/Waiting for your approval \(1\)/)).toBeVisible();
  await ownerPage.getByRole("button", { name: "Approve" }).click();
  await expect(ownerPage.getByText("Stock updated")).toBeVisible();
  await ownerPage.goto("/inventory");
  await expect(ownerPage.locator("li", { hasText: "E2E Jasmine Candle" })).toContainText("25");
});
