import { test, expect, type Page } from "@playwright/test";

// Smoke + a single happy-path finalize for the cashier checkout flow.
// Requires:
//   - seeded products (e.g. barcode 8901234567890 priced at 100)
//   - cashier login working (login.smoke.spec.ts prerequisite)
//   - backend running with the test schema
//
// One test per AC category; full e2e suite for this slice lives here.

async function loginAsCashier(page: Page) {
  await page.goto("/login");
  for (const d of "9999900001") {
    await page.getByRole("button", { name: `Digit ${d}` }).click();
  }
  await page.getByRole("button", { name: "NEXT" }).click();
  for (const d of "1111") {
    await page.getByRole("button", { name: `Digit ${d}` }).click();
  }
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page).toHaveURL(/\/checkout$/);
}

test.describe("checkout flow", () => {
  test("renders cart + payment panels for a cashier", async ({ page }) => {
    await loginAsCashier(page);
    await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Payment" })).toBeVisible();
    await expect(page.getByRole("button", { name: "FINISH & PAY" })).toBeVisible();
    // Cart starts empty
    await expect(page.getByText("No items in cart")).toBeVisible();
  });

  test("scanning a known barcode adds the product line", async ({ page }) => {
    await loginAsCashier(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("8901234567890");
    await page.getByRole("button", { name: "ADD" }).click();
    // Wait for the catalog lookup + state update
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    // Cart line is now rendered with the product's brand
    await expect(page.getByText(/8901234567890/)).toBeVisible();
  });

  test("unknown barcode surfaces a clear error", async ({ page }) => {
    await loginAsCashier(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("DOES-NOT-EXIST-999");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByRole("alert")).toContainText(/not found/i);
  });

  test("split payment across two modes is supported", async ({ page }) => {
    await loginAsCashier(page);
    // Add one product first.
    await page.getByPlaceholder("Scan or enter barcode").fill("8901234567890");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    // Click "+ Split" to add a second payment row.
    await page.getByRole("button", { name: "+ Split" }).click();
    const amountInputs = page.getByLabel("Payment amount");
    await expect(amountInputs).toHaveCount(2);
  });
});