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

  // Issue #39 — live phone validation: error appears as the user types
  // past the 7-digit threshold and clears once the field is valid.
  test("phone field shows inline error on too-short input, clears on valid", async ({
    page,
  }) => {
    await loginAsOwner(page);
    await page.goto("/admin/staff");

    const phone = page.getByLabel("Phone");
    const tooShortError = page.getByRole("alert").filter({ hasText: /at least 7/ });
    const formatError = page.getByRole("alert").filter({ hasText: /7-15 digits/ });

    // Empty: no error yet (don't shout on first paint).
    await expect(tooShortError).toHaveCount(0);
    await expect(formatError).toHaveCount(0);

    // Too short — error appears.
    await phone.fill("123");
    await expect(tooShortError).toBeVisible();

    // Valid length + format — error clears.
    await phone.fill("9876543210");
    await expect(tooShortError).toHaveCount(0);
    await expect(formatError).toHaveCount(0);

    // Garbage characters — format error appears (length OK, but not 7-15 digits).
    await phone.fill("abc12345");
    await expect(formatError).toBeVisible();
  });
});