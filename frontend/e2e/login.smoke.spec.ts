import { test, expect, type Page } from "@playwright/test";

// One smoke test per role: log in and land on the correct home screen.
// These tests assume the backend is running against a clean test schema
// with known seeded users for each role. See tests/conftest.py for the
// per-session DB provisioning pattern.
//
// Required seed (mirror the backend's _test_only router or seed script):
//   - cashier user: phone 9999900001, pin 1111
//   - receiver user: phone 9999900002, pin 2222
//   - owner: phone 9999900003, pin 3333
//   - superadmin: username sa, password sapass

async function loginAsPhone(page: Page, phone: string, pin: string) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Barstock" })).toBeVisible();
  // Type phone digits via the on-screen keypad (per the design).
  for (const d of phone) {
    await page.getByRole("button", { name: `Digit ${d}` }).click();
  }
  await page.getByRole("button", { name: "NEXT" }).click();
  for (const d of pin) {
    await page.getByRole("button", { name: `Digit ${d}` }).click();
  }
  await page.getByRole("button", { name: "LOGIN" }).click();
}

test.describe("auth + role routing", () => {
  test("cashier_user lands on /checkout", async ({ page }) => {
    await loginAsPhone(page, "9999900001", "1111");
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  });

  test("receiver_user lands on /receiving", async ({ page }) => {
    await loginAsPhone(page, "9999900002", "2222");
    await expect(page).toHaveURL(/\/receiving$/);
    await expect(page.getByRole("heading", { name: "Stock Receiving" })).toBeVisible();
  });

  test("owner lands on /dashboard", async ({ page }) => {
    await loginAsPhone(page, "9999900003", "3333");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Owner Dashboard" })).toBeVisible();
  });

  test("forbidden when a receiver tries /checkout", async ({ page }) => {
    await loginAsPhone(page, "9999900002", "2222");
    await page.goto("/checkout");
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  });
});