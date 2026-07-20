import { test, expect, type Page } from "@playwright/test";
import { loginAsRole } from "./helpers/login";

async function expectPageToFitViewport(page: Page) {
  const metrics = await page.evaluate(() => {
    const browser = globalThis as typeof globalThis & {
      innerHeight: number;
      document: { documentElement: { scrollHeight: number } };
    };
    return {
      viewportHeight: browser.innerHeight,
      scrollHeight: browser.document.documentElement.scrollHeight,
    };
  });
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.viewportHeight);
}

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
    await expect(page.getByRole("link", { name: "Terms and Conditions" })).toBeVisible();
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

  test("public login help opens in same tab and returns to shop login", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("barstock.deviceKey", "test-terminal-01");
    });
    await page.goto("/login");
    await page.getByRole("link", { name: "Help" }).click();
    await expect(page).toHaveURL(/\/help\/login$/);
    await expect(page.getByRole("heading", { name: "Login Help" })).toBeVisible();
    await expect(page.getByText("Choose your role")).toBeVisible();
    await expect(page.getByText("How to sign in")).toBeVisible();
    await expect(page.getByText("Common problems and what to do")).toBeVisible();
    await expect(page.getByText("Network or backend not reachable")).toBeVisible();
    await page.getByRole("link", { name: "Back to shop login" }).first().click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("login help stays public while logged out and while logged in", async ({ page }) => {
    await page.goto("/help/login");
    await expect(page.getByRole("heading", { name: "Login Help" })).toBeVisible();

    await loginAsRole(page, "Cashier", "cashpass");
    await page.goto("/help/login");
    await expect(page).toHaveURL(/\/help\/login$/);
    await expect(page.getByRole("heading", { name: "Login Help" })).toBeVisible();
    await expect(page.getByText("Checkout")).toBeVisible();
    await expect(page.getByText("Stock Inward")).toBeVisible();
  });

  test("checkout and stock inward help stay public while logged out and while logged in", async ({ page }) => {
    await page.goto("/help/checkout");
    await expect(page.getByRole("heading", { name: "Checkout Help" })).toBeVisible();
    await expect(page.getByText("How Checkout works")).toBeVisible();
    await expect(page.getByText("Offline finalizing limit")).toBeVisible();

    await page.goto("/help/receiving");
    await expect(page.getByRole("heading", { name: "Stock Inward Help" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How Stock Inward works" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Using quick-add for unknown barcodes" })).toBeVisible();

    await loginAsRole(page, "Cashier", "cashpass");
    await page.goto("/help/checkout");
    await expect(page).toHaveURL(/\/help\/checkout$/);
    await expect(page.getByRole("heading", { name: "Checkout Help" })).toBeVisible();

    await page.goto("/help/receiving");
    await expect(page).toHaveURL(/\/help\/receiving$/);
    await expect(page.getByRole("heading", { name: "Stock Inward Help" })).toBeVisible();
  });

  test("shop and superadmin login fit a laptop-height viewport without page scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      localStorage.setItem("barstock.deviceKey", "test-terminal-01");
    });

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Terminal Access" })).toBeVisible({
      timeout: 5000,
    });
    await expectPageToFitViewport(page);

    await page.goto("/login/superadmin");
    await expect(page.getByRole("heading", { name: "Superadmin Panel" })).toBeVisible({
      timeout: 5000,
    });
    await expectPageToFitViewport(page);
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
