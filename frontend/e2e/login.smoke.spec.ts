import { test, expect } from "@playwright/test";
import { loginAsRole } from "./helpers/login";

test.describe("auth + role routing", () => {
  test("cashier_user lands on /checkout", async ({ page }) => {
    await loginAsRole(page, "Cashier", "cashpass");
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  });

  test("receiver_user lands on /receiving", async ({ page }) => {
    await loginAsRole(page, "Receiver", "recvpass");
    await expect(page).toHaveURL(/\/receiving$/);
    await expect(page.getByRole("heading", { name: "Stock Inward" })).toBeVisible();
  });

  test("owner lands on /dashboard", async ({ page }) => {
    await loginAsRole(page, "Owner", "ownerpass");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Owner Dashboard" })).toBeVisible();
  });

  test("forbidden when a receiver tries /checkout", async ({ page }) => {
    await loginAsRole(page, "Receiver", "recvpass");
    await page.goto("/checkout");
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  });
});

test.describe("login UX", () => {
  test("renders segmented role controls and terminal shell chrome", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("barstock.deviceKey", "test-terminal-01");
    });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Terminal Access" })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole("radio", { name: "Cashier" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Stock Keeper" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Shop Owner" })).toBeVisible();
    await expect(page.getByLabel("Terminal ID / Username")).toBeVisible();
    await expect(page.getByLabel("Security PIN")).toBeVisible();
    await expect(page.getByRole("link", { name: "Help" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
  });

  test("secondary ctas navigate between login screens", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("barstock.deviceKey", "test-terminal-01");
    });
    await page.goto("/login");
    await page.getByRole("link", { name: "Need superadmin access?" }).click();
    await expect(page).toHaveURL(/\/login\/superadmin$/);
    await expect(page.getByRole("heading", { name: "Superadmin Panel" })).toBeVisible();
    await page.getByRole("link", { name: "Back to shop login" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("mobile layout keeps the login card usable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("barstock.deviceKey", "test-terminal-01");
    });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Terminal Access" })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole("button", { name: "Open Terminal" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Need superadmin access?" })).toBeVisible();
  });
});
