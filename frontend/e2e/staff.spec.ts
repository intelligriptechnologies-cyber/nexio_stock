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

test.describe("staff management", () => {
  test("owner sees the staff list and create form", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/staff");
    await expect(page.getByRole("heading", { name: "Staff" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "New staff account" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current staff" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create staff account" })).toBeVisible();
  });

  test("cashier cannot reach staff management", async ({ page }) => {
    await loginAsCashier(page);
    await page.goto("/admin/staff");
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  });
});