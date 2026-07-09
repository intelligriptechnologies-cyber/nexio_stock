import { test, expect, type Page } from "@playwright/test";
import { loginAsCashier as _loginAsCashier, loginAsOwner as _loginAsOwner, loginAsReceiver as _loginAsReceiver } from "./helpers/login";
const _login = { loginAsCashier: _loginAsCashier, loginAsOwner: _loginAsOwner, loginAsReceiver: _loginAsReceiver };
async function loginAsOwner(page: Page) {
  return _login.loginAsOwner(page);
}
async function loginAsCashier(page: Page) {
  return _login.loginAsCashier(page);
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
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Today" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Past Invoices" })).toBeVisible();
  });

  test("cashier cannot reach the void approvals queue", async ({ page }) => {
    await loginAsCashier(page);
    await page.goto("/admin/voids");
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  });
});
