import { test, expect } from "@playwright/test";
import { loginAsRole } from "./helpers/login";

test.describe("auth + role routing", () => {
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

test.describe("login UX", () => {
  test("renders role-first form", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("barstock.deviceKey", "test-terminal-01");
    });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Shop login" })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByLabel("Role")).toBeVisible();
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("PIN / password")).toBeVisible();
  });

  test("superadmin link routes to /login/superadmin", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("barstock.deviceKey", "test-terminal-01");
    });
    await page.goto("/login");
    await page.getByRole("button", { name: "Superadmin login" }).click();
    await expect(page).toHaveURL(/\/login\/superadmin$/);
  });
});
