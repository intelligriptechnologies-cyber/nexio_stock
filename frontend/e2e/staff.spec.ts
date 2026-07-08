import { test, expect, type Page } from "@playwright/test";
import { loginAsCashier as _loginAsCashier, loginAsOwner as _loginAsOwner, loginAsReceiver as _loginAsReceiver } from "./helpers/login";
const _login = { loginAsCashier: _loginAsCashier, loginAsOwner: _loginAsOwner, loginAsReceiver: _loginAsReceiver };
async function loginAsOwner(page: Page) {
  return _login.loginAsOwner(page);
}
async function loginAsCashier(page: Page) {
  return _login.loginAsCashier(page);
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