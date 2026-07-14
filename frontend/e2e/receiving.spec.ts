import { test, expect, type Page } from "@playwright/test";
import { loginAsOwner, loginAsReceiver } from "./helpers/login";

// The receiving flow now needs an active vendor before the review modal
// can submit. This helper logs in as owner, creates a vendor, logs out,
// then logs back in as receiver so each spec starts with the right data.
async function prepareReceivingSession(page: Page) {
  await loginAsOwner(page);
  await page.goto("/admin/vendors");
  await expect(page.getByRole("heading", { name: "Vendors" })).toBeVisible({ timeout: 5000 });
  await page.getByLabel("Name").fill("E2E Vendor");
  await page.getByLabel("GSTIN").fill("21ABCDE1234F1Z5");
  await page.getByLabel("Address").fill("Test address");
  await page.getByLabel("Email").fill("vendor@example.com");
  await page.getByLabel("Phone").fill("+15555550004");
  await page.getByRole("button", { name: "Create vendor" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Vendor created." })).toBeVisible({
    timeout: 5000,
  });

  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await loginAsReceiver(page);
}

test.describe("stock inward - new lot", () => {
  test("renders the receiving panel for a receiver", async ({ page }) => {
    await loginAsReceiver(page);
    await expect(page.getByRole("heading", { name: "Stock Inward" })).toBeVisible();
    await expect(page.getByRole("button", { name: "REVIEW & SAVE" })).toBeVisible();
    await expect(page.getByText("No items yet")).toBeVisible();
  });

  test("scanning a barcode adds a line with default quantity", async ({ page }) => {
    await loginAsReceiver(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("8901234567890");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("scan-success-overlay")).toHaveCount(0);
    await expect(page.getByLabel("Quantity")).toHaveValue("1");
    await expect(page.getByRole("button", { name: "Increase quantity" })).toBeVisible();
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

  test("scanned lines expose fast quantity controls", async ({ page }) => {
    await loginAsReceiver(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("8901234567890");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel("Quantity")).toHaveValue("1");
    await expect(page.getByRole("button", { name: "Increase quantity" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Decrease quantity" })).toBeVisible();
  });

  test("unknown barcode surfaces a clear error", async ({ page }) => {
    await loginAsReceiver(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("NOPE-NOT-IN-CATALOG");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByRole("alert")).toContainText(/not found/i);
  });
});

// --- Issue #22 - quick-add new product on the spot. -------------------

test.describe("stock inward - quick-add new product (issue #22)", () => {
  test("unknown barcode opens the quick-add modal", async ({ page }) => {
    await loginAsReceiver(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("QUICKADD-NEW-001");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(
      page.getByRole("dialog", { name: "Quick-add new product" })
    ).toBeVisible({ timeout: 5000 });
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
    await expect(page.getByText("Quick Brand")).toBeVisible();
    await expect(page.getByText("750ml")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /pending/i })).toBeVisible();
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

// --- Issue #23 - quicksearch by name or barcode. --------------------------

test.describe("stock inward - quicksearch (issue #23)", () => {
  test("typing a brand substring shows matching products in a dropdown", async ({
    page,
  }) => {
    await loginAsReceiver(page);
    const search = page.getByRole("combobox", {
      name: "Quick-search products by name or barcode",
    });
    await search.fill("stag");
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
    await expect(page.getByLabel("Quantity")).toHaveValue("1");
    await expect(page.getByText(/Added:/)).toBeVisible();
    await expect(page.getByTestId("scan-success-overlay")).toHaveCount(0);
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

  test("review modal collects vendor and condition counts before save", async ({
    page,
  }) => {
    await prepareReceivingSession(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("8901234567890");
    await page.getByRole("button", { name: "ADD" }).click();
    await page.getByRole("button", { name: "REVIEW & SAVE" }).click();
    const dialog = page.getByRole("dialog", { name: "Review purchase details" });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(
      dialog.getByText("Use the stepper to adjust good-condition quantity for each line.")
    ).toBeVisible();
    await dialog.getByLabel("Vendor").selectOption({ label: "E2E Vendor" });
    await dialog.getByLabel("Vendor invoice number").fill("E2E-INV-1");
    await dialog.getByLabel("Invoice value").fill("100.00");
    await dialog.getByLabel("Decrease good quantity").click();
    await dialog.getByRole("button", { name: "Confirm save" }).click();
    await expect(dialog).toContainText("Add notes when any breakage exists.");
    await dialog.getByLabel("Notes (required when breakage exists)").fill("Bottle arrived broken");
    await dialog.getByRole("button", { name: "Confirm save" }).click();
    await expect(page.getByRole("dialog", { name: "Review purchase details" })).toHaveCount(0);
    await expect(page.getByText(/Lot #\d+ saved/)).toBeVisible({ timeout: 5000 });
  });

});
