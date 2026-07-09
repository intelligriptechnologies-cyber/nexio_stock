import { test, expect, type Page } from "@playwright/test";
import { loginAsCashier as _loginAsCashier, loginAsOwner as _loginAsOwner, loginAsReceiver as _loginAsReceiver } from "./helpers/login";
const _login = { loginAsCashier: _loginAsCashier, loginAsOwner: _loginAsOwner, loginAsReceiver: _loginAsReceiver };
async function loginAsOwner(page: Page) {
  return _login.loginAsOwner(page);
}
async function loginAsCashier(page: Page) {
  return _login.loginAsCashier(page);
}

test.describe("settings", () => {
  test("owner reaches invoice settings from the old shop config URL", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/shop");
    await expect(page).toHaveURL(/\/admin\/settings$/);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.getByRole("button", { name: "Invoice Settings" }).click();
    await expect(page.getByText(/GSTIN/)).toBeVisible();
    await expect(page.getByText(/Excise duty rate/)).toBeVisible();
    await expect(page.getByText(/Default low-stock threshold/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  });

  test("cashier cannot reach settings", async ({ page }) => {
    await loginAsCashier(page);
    await page.goto("/admin/shop");
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  });
});
