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

test.describe("void — owner queue + cashier request", () => {
  test("owner sees the void approvals page", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/voids");
    await expect(page.getByRole("heading", { name: "Void approvals" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  });

  test("cashier sees the invoice lookup page", async ({ page }) => {
    await loginAsCashier(page);
    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: "Invoice lookup" })).toBeVisible();
    await expect(page.getByRole("button", { name: "LOOKUP" })).toBeVisible();
  });

  test("cashier cannot reach the void approvals queue", async ({ page }) => {
    await loginAsCashier(page);
    await page.goto("/admin/voids");
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  });
});