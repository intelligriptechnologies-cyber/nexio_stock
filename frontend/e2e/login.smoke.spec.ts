import { test, expect } from "@playwright/test";

// One smoke test per role: pick a name from the staff picker, enter a
// PIN, land on the correct home screen. (Issue #24 — login flow is now
// two stages: PICKER + PIN, not phone-entry + PIN.)
//
// These tests assume the backend is running against a clean test schema
// with known seeded users for each role. See tests/conftest.py for the
// per-session DB provisioning pattern.
//
// Required seed (mirror the backend's _test_only router or seed script):
//   - cashier user: phone 9999900001, pin 1111, name "Cashier One"
//   - receiver user: phone 9999900002, pin 2222, name "Receiver One"
//   - owner: phone 9999900003, pin 3333, name "Owner One"
//   - superadmin: username sa, password sapass

import { loginAsRole } from "./helpers/login";

test.describe("auth + role routing (issue #24 picker flow)", () => {
  test("cashier_user lands on /checkout", async ({ page }) => {
    await loginAsRole(page, "Cashier", "1111");
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  });

  test("receiver_user lands on /receiving", async ({ page }) => {
    await loginAsRole(page, "Receiver", "2222");
    await expect(page).toHaveURL(/\/receiving$/);
    await expect(page.getByRole("heading", { name: "Stock Receiving" })).toBeVisible();
  });

  test("owner lands on /dashboard", async ({ page }) => {
    await loginAsRole(page, "Owner", "3333");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Owner Dashboard" })).toBeVisible();
  });

  test("forbidden when a receiver tries /checkout", async ({ page }) => {
    await loginAsRole(page, "Receiver", "2222");
    await page.goto("/checkout");
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  });
});

test.describe("login picker UX (issue #24)", () => {
  test("picker renders a row per active shop-scoped user", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Tap your name to sign in")).toBeVisible({ timeout: 5000 });
    const rows = page.locator('[data-testid="staff-row"]');
    // The test seed has owner + receiver + cashier (3 active rows).
    await expect(rows).toHaveCount(3, { timeout: 5000 });
  });

  test("back button returns from PIN pad to the picker", async ({ page }) => {
    await page.goto("/login");
    const row = page.locator('[data-testid="staff-row"]').first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.click();
    await expect(page.getByText("Enter your PIN")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByText("Tap your name to sign in")).toBeVisible();
  });

  test("superadmin link still routes to /login/superadmin", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Superadmin login" }).click();
    await expect(page).toHaveURL(/\/login\/superadmin$/);
  });

  test("wrong PIN shows an error and stays on the PIN pad", async ({ page }) => {
    await page.goto("/login");
    const row = page.locator('[data-testid="staff-row"]').first();
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.click();
    // Enter a wrong PIN.
    for (const d of "9999") {
      await page.getByRole("button", { name: `Digit ${d}` }).click();
    }
    await page.getByRole("button", { name: "LOGIN" }).click();
    await expect(page.getByText(/Invalid PIN/)).toBeVisible({ timeout: 5000 });
  });
});