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

test.describe("dashboard", () => {
  test("owner sees the dashboard with KPI cards", async ({ page }) => {
    await loginAsOwner(page);
    await expect(page.getByRole("heading", { name: "Owner Dashboard" })).toBeVisible();
    await expect(page.getByText("Business date")).toBeVisible();
    await expect(page.getByText("Revenue")).toBeVisible();
    await expect(page.getByText("Voids")).toBeVisible();
    await expect(page.getByText("EOD status")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Payment mode split" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Low stock" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Past sign-offs" })).toBeVisible();
  });

  test("cashier cannot reach /dashboard", async ({ page }) => {
    await loginAsCashier(page);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  });
});