import { expect, test, type Page } from "@playwright/test";

type Role = "owner" | "cashier_user" | "superadmin";

const products = [
  {
    id: 1,
    shop_id: 1,
    barcode: "INV-HEALTHY-001",
    brand: "Healthy Brand",
    size_label: "750ml",
    price: "500.00",
    low_stock_threshold: 5,
    is_active: true,
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    current_stock: 12,
  },
  {
    id: 2,
    shop_id: 1,
    barcode: "INV-LOW-002",
    brand: "Low Brand",
    size_label: "1L",
    price: "650.00",
    low_stock_threshold: 4,
    is_active: true,
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    current_stock: 3,
  },
  {
    id: 3,
    shop_id: 1,
    barcode: "INV-ZERO-003",
    brand: "Zero Brand",
    size_label: "375ml",
    price: "300.00",
    low_stock_threshold: null,
    is_active: true,
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    current_stock: 0,
  },
];

function tokenFor(role: Role): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "1",
      shop_id: role === "superadmin" ? null : 1,
      role,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString("base64url");
  return `${header}.${payload}.signature`;
}

async function seedSession(page: Page, role: Role) {
  await page.addInitScript(
    ({ role: seededRole, token }) => {
      const storage = (
        globalThis as unknown as { sessionStorage: { setItem: (key: string, value: string) => void } }
      ).sessionStorage;
      storage.setItem("barstock.token", token);
      storage.setItem(
        "barstock.user",
        JSON.stringify({
          id: 1,
          shopId: seededRole === "superadmin" ? null : 1,
          role: seededRole,
          username: seededRole,
          fullName: seededRole,
          phone: "0000000000",
        })
      );
    },
    { role, token: tokenFor(role) }
  );
}

async function mockShellApis(page: Page) {
  await page.route("**/settings/me**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: 1,
        name: "Shop One",
        code: "shop1",
        app_display_name: "BarStock",
        action_color: "#22c55e",
        active_tab_color: "#5a5148",
        sidebar_menu_inactive_text_color: "#535353cf",
        sidebar_menu_active_text_color: "#ffffff",
        email_enabled: false,
        smtp_host: null,
        smtp_port: null,
        smtp_username: null,
        smtp_from_email: null,
        smtp_from_name: null,
        smtp_use_tls: true,
        gstin: null,
        excise_duty_rate: null,
        low_stock_threshold_default: null,
      }),
    });
  });
  await page.route("**/products/pending/count**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 0 }) });
  });
  await page.route("**/products?**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(products) });
  });
}

test.describe("inventory", () => {
  test("owner can open inventory and see the table", async ({ page }) => {
    await seedSession(page, "owner");
    await mockShellApis(page);

    await page.goto("/inventory");

    await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Inventory table" })).toBeVisible();
    await expect(page.getByText("Healthy Brand")).toBeVisible();
    await expect(page.getByText("Available stock")).toBeVisible();
  });

  test("cashier is redirected from inventory to forbidden", async ({ page }) => {
    await seedSession(page, "cashier_user");

    await page.goto("/inventory");

    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  });

  test("search filters by brand, size, and barcode", async ({ page }) => {
    await seedSession(page, "owner");
    await mockShellApis(page);
    await page.goto("/inventory");

    const search = page.getByLabel("Search");
    await search.fill("Low Brand");
    await expect(page.getByText("Low Brand")).toBeVisible();
    await expect(page.getByText("Healthy Brand")).not.toBeVisible();

    await search.fill("375ml");
    await expect(page.getByText("Zero Brand")).toBeVisible();
    await expect(page.getByText("Low Brand")).not.toBeVisible();

    await search.fill("INV-HEALTHY-001");
    await expect(page.getByText("Healthy Brand")).toBeVisible();
    await expect(page.getByText("Zero Brand")).not.toBeVisible();
  });

  test("stock-state filter handles in-stock, low-stock, and out-of-stock rows", async ({
    page,
  }) => {
    await seedSession(page, "owner");
    await mockShellApis(page);
    await page.goto("/inventory");

    const filter = page.getByLabel("Stock state");
    await filter.selectOption("in_stock");
    await expect(page.getByText("Healthy Brand")).toBeVisible();
    await expect(page.getByText("Low Brand")).not.toBeVisible();
    await expect(page.getByText("Zero Brand")).not.toBeVisible();

    await filter.selectOption("low_stock");
    await expect(page.getByText("Low Brand")).toBeVisible();
    await expect(page.getByText("Healthy Brand")).not.toBeVisible();

    await filter.selectOption("out_of_stock");
    await expect(page.getByText("Zero Brand")).toBeVisible();
    await expect(page.getByText("Low Brand")).not.toBeVisible();
  });

  test("shortcuts navigate to receiving and product editing", async ({ page }) => {
    await seedSession(page, "owner");
    await mockShellApis(page);
    await page.goto("/inventory");

    await page.getByRole("link", { name: "Receive" }).first().click();
    await expect(page).toHaveURL(/\/receiving$/);

    await page.goto("/inventory");
    await page.getByRole("link", { name: "Edit product" }).first().click();
    await expect(page).toHaveURL(/\/admin\/products$/);
  });
});
