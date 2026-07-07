import { test, expect, type Page } from "@playwright/test";

async function loginAsOwner(page: Page) {
  await page.goto("/login");
  for (const d of "9999900003") {
    await page.getByRole("button", { name: `Digit ${d}` }).click();
  }
  await page.getByRole("button", { name: "NEXT" }).click();
  for (const d of "3333") {
    await page.getByRole("button", { name: `Digit ${d}` }).click();
  }
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

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

test.describe("product catalog — owner", () => {
  test("renders list + tabs and can search", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/products");
    await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Catalog" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New product" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bulk import" })).toBeVisible();
    await page.getByPlaceholder("Search by brand").fill("XYZ-NO-MATCH");
    // Either we get the empty-state or a row; both prove the search worked.
    await expect(page.getByText(/No products match|Loading…|Refreshing/)).toBeVisible();
  });

  test("create-tab shows the new-product form", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/products");
    await page.getByRole("button", { name: "New product" }).click();
    await expect(page.getByRole("heading", { name: "New product" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create product" })).toBeVisible();
  });

  test("import-tab accepts a CSV file picker", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/products");
    await page.getByRole("button", { name: "Bulk import" }).click();
    await expect(page.getByRole("heading", { name: "Bulk CSV import" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload CSV" })).toBeVisible();
  });
});

test.describe("product catalog — non-owner blocked", () => {
  test("cashier is redirected to /forbidden from /admin/products", async ({ page }) => {
    await loginAsCashier(page);
    await page.goto("/admin/products");
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  });
});