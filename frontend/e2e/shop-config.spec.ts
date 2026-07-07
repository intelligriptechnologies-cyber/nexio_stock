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

test.describe("shop config", () => {
  test("owner sees the shop config form with all three fields", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/shop");
    await expect(page.getByRole("heading", { name: "Shop Config" })).toBeVisible();
    await expect(page.getByText(/GSTIN/)).toBeVisible();
    await expect(page.getByText(/Excise duty rate/)).toBeVisible();
    await expect(page.getByText(/Default low-stock threshold/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save shop config" })).toBeVisible();
  });

  test("cashier cannot reach shop config", async ({ page }) => {
    await loginAsCashier(page);
    await page.goto("/admin/shop");
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  });
});