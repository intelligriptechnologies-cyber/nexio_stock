import { test, expect, type Page } from "@playwright/test";

// Smoke + a single happy-path finalize for the cashier checkout flow.
// Requires:
//   - seeded products (e.g. barcode 8901234567890 priced at 100)
//   - cashier login working (login.smoke.spec.ts prerequisite)
//   - backend running with the test schema
//
// One test per AC category; full e2e suite for this slice lives here.

// Issue #24 — login flow is now PICKER + PIN.
async function loginAsCashier(page: Page) {
  await page.goto("/login");
  await expect(page.getByText("Tap your name to sign in")).toBeVisible({
    timeout: 5000,
  });
  const row = page.locator(
    '[data-testid="staff-row"][data-staff-role="cashier_user"]'
  );
  await expect(row).toBeVisible({ timeout: 5000 });
  await row.click();
  await expect(page.getByText("Enter your PIN")).toBeVisible();
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

// --- Issue #42 — show available stock per shop in cart / lot lines. ---

test.describe("checkout flow — per-line stock (issue #42)", () => {
  test("cart line shows 'In stock: <n>' from the catalog snapshot", async ({
    page,
  }) => {
    await loginAsCashier(page);
    const search = page.getByRole("combobox", {
      name: "Quick-search products by name or barcode",
    });
    await search.fill("stag");
    const option = page.getByRole("option").filter({ hasText: "Royal Stag" });
    await option.click();
    // The cart line should show the stock snapshot pulled from the
    // catalog at scan time (issue #42).
    await expect(page.getByText(/In stock:/)).toBeVisible({ timeout: 5000 });
  });
});

// --- Issue #23 — quicksearch at checkout. -------------------------------

test.describe("checkout flow — quicksearch (issue #23)", () => {
  test("quicksearch dropdown matches brand substring and adds to cart", async ({
    page,
  }) => {
    await loginAsCashier(page);
    const search = page.getByRole("combobox", {
      name: "Quick-search products by name or barcode",
    });
    await search.fill("stag");
    const option = page.getByRole("option").filter({ hasText: "Royal Stag" });
    await expect(option).toBeVisible({ timeout: 5000 });
    await option.click();
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    // Search cleared, cart line is present.
    await expect(search).toHaveValue("");
  });
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

  test("global scanner adds a known barcode from any focused field", async ({ page }) => {
    await loginAsCashier(page);
    await page.getByLabel("Note (optional)").focus();
    await page.keyboard.type("8901234567890", { delay: 1 });
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/8901234567890/)).toBeVisible();
  });

  test("unknown barcode surfaces a clear error", async ({ page }) => {
    await loginAsCashier(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("DOES-NOT-EXIST-999");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByRole("alert")).toContainText(/not found/i);
  });

  test("global scanner opens quick-add for an unknown barcode", async ({ page }) => {
    await loginAsCashier(page);
    const barcode = `CHECKOUT-SCAN-${Date.now()}`;
    await page.keyboard.type(barcode, { delay: 1 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Quick-add new product" });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText(barcode);
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
