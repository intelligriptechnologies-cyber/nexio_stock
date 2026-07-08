import { test, expect, type Page } from "@playwright/test";
import { loginAsCashier as _loginAsCashier, loginAsOwner as _loginAsOwner, loginAsReceiver as _loginAsReceiver } from "./helpers/login";
const _login = { loginAsCashier: _loginAsCashier, loginAsOwner: _loginAsOwner, loginAsReceiver: _loginAsReceiver };
async function loginAsOwner(page: Page) {
  return _login.loginAsOwner(page);
}
async function loginAsCashier(page: Page) {
  return _login.loginAsCashier(page);
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