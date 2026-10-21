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

test("owner bills 1 carton + 3 pieces with freight; stock panel shows the item; stock drops from 20 to 7", async ({ page }) => {
  await login(page, E2E_OWNER);
  await page.goto("/billing/new");

  await page.getByRole("button", { name: "Choose customer…" }).click();
  await page.getByPlaceholder("Name, mobile or GSTIN…").fill("E2E");
  await page.getByRole("option", { name: /E2E Traders/ }).click();

  await page.getByRole("button", { name: "Choose item…" }).click();
  await page.getByRole("option", { name: /E2E Lavender Candle/ }).click();
  // The stock panel appears beside the form as soon as an item is chosen.
  await expect(page.getByTestId("stock-bar")).toContainText("2 cartons (20 pcs)");
  await expect(page.getByTestId("qty-per-carton")).toHaveText("10");
  await page.getByLabel("Cartons", { exact: true }).fill("1");
  await page.getByLabel("Extra pieces").fill("3");
  await expect(page.getByTestId("total-qty")).toContainText("13");
  await expect(page.getByTestId("stock-bar")).toContainText("After this bill: 7 pcs");
  await page.getByLabel("Freight charges").fill("100");
  await expect(page.getByText("Grand total")).toBeVisible(); // live preview arrived

  await page.getByRole("button", { name: /Save bill/ }).click();
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);
  await expect(page.getByRole("heading", { name: /TC\/\d{4}\/\d{5}/ }).first()).toBeVisible();

  // The invoice PDF opens as a real PDF (fonts load, QR renders, no server crash).
  const pdfPath = new URL(page.url()).pathname.replace("/bills/", "/api/bills/") + "/pdf";
  const pdf = await page.request.get(pdfPath);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");

  await page.goto("/inventory");
  await expect(page.locator("li", { hasText: "E2E Lavender Candle" })).toContainText("7 pcs");
});

test("a worker cannot open billing and sees no money", async ({ page }) => {
  await login(page, E2E_WORKER);
  await page.goto("/billing/new");
  await expect(page).toHaveURL(/\/dashboard|\/account\/password/);
  await expect(page.getByText("₹")).toHaveCount(0);
});
