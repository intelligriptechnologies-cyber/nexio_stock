import { test, expect, type Page } from "@playwright/test";
import { loginAsCashier as _loginAsCashier, loginAsOwner as _loginAsOwner, loginAsReceiver as _loginAsReceiver } from "./helpers/login";
const _login = { loginAsCashier: _loginAsCashier, loginAsOwner: _loginAsOwner, loginAsReceiver: _loginAsReceiver };
async function loginAsOwner(page: Page) {
  return _login.loginAsOwner(page);
}
async function loginAsCashier(page: Page) {
  return _login.loginAsCashier(page);
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