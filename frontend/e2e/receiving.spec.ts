import { test, expect, type Page } from "@playwright/test";

// Issue #24 — login flow is now PICKER + PIN. The loginAsReceiver
// helper picks the receiver from the staff picker, then enters the PIN.
async function loginAsReceiver(page: Page) {
  await page.goto("/login");
  await expect(page.getByText("Tap your name to sign in")).toBeVisible({
    timeout: 5000,
  });
  const row = page.locator(
    '[data-testid="staff-row"][data-staff-role="receiver_user"]'
  );
  await expect(row).toBeVisible({ timeout: 5000 });
  await row.click();
  await expect(page.getByText("Enter your PIN")).toBeVisible();
  for (const d of "2222") {
    await page.getByRole("button", { name: `Digit ${d}` }).click();
  }
  await page.getByRole("button", { name: "LOGIN", exact: true }).click();
  await expect(page).toHaveURL(/\/receiving$/);
}

test.describe("stock receiving — new lot", () => {
  test("renders the receiving panel for a receiver", async ({ page }) => {
    await loginAsReceiver(page);
    await expect(page.getByRole("heading", { name: "Stock Receiving" })).toBeVisible();
    await expect(page.getByRole("button", { name: "SAVE STOCK" })).toBeVisible();
    await expect(page.getByText("No items yet")).toBeVisible();
  });

  test("scanning a barcode adds a line with default quantity", async ({ page }) => {
    await loginAsReceiver(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("8901234567890");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("scan-success-overlay")).toHaveCount(0);
    // The quantity input defaults to 1.
    await expect(page.getByLabel("Quantity")).toHaveValue("1");
  });

  test("global scanner adds a line even when another field is focused", async ({ page }) => {
    await loginAsReceiver(page);
    await page.getByLabel("Reference (optional)").focus();
    await page.keyboard.type("8901234567890", { delay: 1 });
    await page.keyboard.press("Enter");
    const overlay = page.getByTestId("scan-success-overlay");
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await expect(overlay).toContainText("Royal Stag");
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel("Quantity")).toHaveValue("1");
    await expect(overlay).not.toBeVisible({ timeout: 2500 });
    await expect(page.getByLabel("Quantity")).toHaveValue("1");
  });

  test("quantity +/- buttons adjust the line", async ({ page }) => {
    await loginAsReceiver(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("8901234567890");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    await page.getByRole("button", { name: "Increase quantity" }).click();
    await page.getByRole("button", { name: "Increase quantity" }).click();
    await expect(page.getByLabel("Quantity")).toHaveValue("3");
    await page.getByRole("button", { name: "Decrease quantity" }).click();
    await expect(page.getByLabel("Quantity")).toHaveValue("2");
  });

  test("unknown barcode surfaces a clear error", async ({ page }) => {
    await loginAsReceiver(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("NOPE-NOT-IN-CATALOG");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByRole("alert")).toContainText(/not found/i);
  });
});

// --- Issue #22 — quick-add new product on the spot. -------------------

test.describe("stock receiving — quick-add new product (issue #22)", () => {
  test("unknown barcode opens the quick-add modal", async ({ page }) => {
    await loginAsReceiver(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("QUICKADD-NEW-001");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(
      page.getByRole("dialog", { name: "Quick-add new product" })
    ).toBeVisible({ timeout: 5000 });
    // The barcode we tried to scan should be displayed in the modal so
    // the receiver can confirm they're quick-adding the right thing.
    await expect(
      page.getByRole("dialog", { name: "Quick-add new product" })
    ).toContainText("QUICKADD-NEW-001");
  });

  test("global scanner opens quick-add for a missing barcode", async ({ page }) => {
    await loginAsReceiver(page);
    const barcode = `QUICKADD-SCAN-${Date.now()}`;
    await page.keyboard.type(barcode, { delay: 1 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Quick-add new product" });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText(barcode);
    await expect(page.getByTestId("scan-success-overlay")).toHaveCount(0);
  });

  test("submitting the quick-add form adds the line and closes the modal", async ({
    page,
  }) => {
    await loginAsReceiver(page);
    const newBarcode = `QUICKADD-NEW-${Date.now()}`;
    await page.getByPlaceholder("Scan or enter barcode").fill(newBarcode);
    await page.getByRole("button", { name: "ADD" }).click();
    const dialog = page.getByRole("dialog", { name: "Quick-add new product" });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByPlaceholder("e.g. Royal Stag").fill("Quick Brand");
    await dialog.getByPlaceholder("e.g. 750ml").fill("750ml");
    await dialog.getByRole("button", { name: "ADD" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    // The new product should now be in the lines panel as a normal
    // receivable line (D-v2-6).
    await expect(page.getByText("Quick Brand")).toBeVisible();
    await expect(page.getByText("750ml")).toBeVisible();
    // The receiver was told the item is pending — owner needs to set the price.
    await expect(
      page.getByRole("status").filter({ hasText: /pending/i })
    ).toBeVisible();
  });

  test("cancel button closes the quick-add modal without adding a line", async ({
    page,
  }) => {
    await loginAsReceiver(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("QUICKADD-CANCEL-001");
    await page.getByRole("button", { name: "ADD" }).click();
    const dialog = page.getByRole("dialog", { name: "Quick-add new product" });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("No items yet")).toBeVisible();
  });
});

// --- Issue #23 — quicksearch by name or barcode. --------------------------

test.describe("stock receiving — quicksearch (issue #23)", () => {
  test("typing a brand substring shows matching products in a dropdown", async ({
    page,
  }) => {
    await loginAsReceiver(page);
    // The test seed ships a product with brand "Royal Stag" — searching
    // for "stag" should surface it.
    const search = page.getByRole("combobox", {
      name: "Quick-search products by name or barcode",
    });
    await search.fill("stag");
    // Dropdown should appear with the matching product.
    const option = page.getByRole("option").filter({ hasText: "Royal Stag" });
    await expect(option).toBeVisible({ timeout: 5000 });
  });

  test("typing a partial barcode substring shows matching products", async ({
    page,
  }) => {
    await loginAsReceiver(page);
    const search = page.getByRole("combobox", {
      name: "Quick-search products by name or barcode",
    });
    await search.fill("8901234");
    // The seed barcode "8901234567890" should match the partial.
    const option = page.getByRole("option").filter({ hasText: "8901234567890" });
    await expect(option).toBeVisible({ timeout: 5000 });
  });

  test("tapping a quicksearch match adds it to the lines like a scan", async ({
    page,
  }) => {
    await loginAsReceiver(page);
    const search = page.getByRole("combobox", {
      name: "Quick-search products by name or barcode",
    });
    await search.fill("Royal Stag");
    const option = page.getByRole("option").filter({ hasText: "Royal Stag" });
    await expect(option).toBeVisible({ timeout: 5000 });
    await option.click();
    // Line added to the panel.
    await expect(page.getByLabel("Quantity")).toHaveValue("1");
    await expect(page.getByText(/Added:/)).toBeVisible();
    await expect(page.getByTestId("scan-success-overlay")).toHaveCount(0);
    // Search dropdown cleared.
    await expect(search).toHaveValue("");
  });

  test("typing something that matches nothing shows 'No matches'", async ({
    page,
  }) => {
    await loginAsReceiver(page);
    const search = page.getByRole("combobox", {
      name: "Quick-search products by name or barcode",
    });
    await search.fill("zzznomatchstringzzz");
    await expect(page.getByText("No matches.")).toBeVisible({ timeout: 5000 });
  });
});
