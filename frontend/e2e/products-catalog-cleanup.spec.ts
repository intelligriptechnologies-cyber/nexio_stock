import { expect, test, type Page } from "@playwright/test";

type Role = "owner" | "superadmin";

const shops = [
  { id: 1, name: "Central Shop", code: "central" },
  { id: 2, name: "North Shop", code: "north" },
];

const products = [
  {
    id: 1,
    shop_id: 1,
    barcode: "CAT-001",
    brand: "Central Brand",
    size_label: "750ml",
    price: "500.00",
    low_stock_threshold: 5,
    is_active: true,
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    current_stock: 12,
    can_permanently_delete: false,
  },
  {
    id: 2,
    shop_id: 2,
    barcode: "CAT-002",
    brand: "North Brand",
    size_label: "1L",
    price: "650.00",
    low_stock_threshold: 4,
    is_active: false,
    status: "active",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    current_stock: 3,
    can_permanently_delete: true,
  },
];

function tokenFor(): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "1",
      shop_id: null,
      role: "superadmin",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString("base64url");
  return `${header}.${payload}.signature`;
}

async function seedSession(page: Page, role: Role, actingShopId: number | null = null) {
  await page.addInitScript(
    ({ role: seededRole, token, actingShopId: seededActingShopId }) => {
      sessionStorage.setItem("barstock.token", token);
      sessionStorage.setItem(
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
      if (seededActingShopId != null) {
        sessionStorage.setItem("barstock.actingShopId", String(seededActingShopId));
      }
    },
    { role, token: tokenFor(), actingShopId }
  );
}

async function mockShellApis(page: Page, productUrls: string[] = []) {
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
  await page.route("**/auth/shop-staff", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route("**/shops", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(shops) });
  });
  await page.route("**/products?**", async (route) => {
    productUrls.push(route.request().url());
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(products) });
  });
}

test.describe("product catalog cleanup", () => {
  test("owner catalog omits stock, keeps low-stock, and has no shop filter", async ({ page }) => {
    await seedSession(page, "owner");
    await mockShellApis(page);

    await page.goto("/admin/products");

    const header = page.locator("thead");
    await expect(header.getByRole("columnheader", { name: "Stock" })).toHaveCount(0);
    await expect(header.getByRole("columnheader", { name: "Low-stock" })).toBeVisible();
    await expect(header.getByRole("columnheader", { name: "Shop" })).toHaveCount(0);
    await expect(page.getByLabel("Shop", { exact: true })).toHaveCount(0);
  });

  test("superadmin all-shops catalog calls products without shop_id and shows shop labels", async ({
    page,
  }) => {
    const productUrls: string[] = [];
    await seedSession(page, "superadmin");
    await mockShellApis(page, productUrls);

    await page.goto("/admin/products");

    await expect(page.getByLabel("Shop", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Shop", { exact: true })).toContainText("All shops");
    await expect(page.getByLabel("Shop", { exact: true })).toContainText("Central Shop (central)");
    await expect(page.getByRole("cell", { name: "Central Shop (central)" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "North Shop (north)" })).toBeVisible();
    await expect
      .poll(() => productUrls.some((url) => !new URL(url).searchParams.has("shop_id")))
      .toBe(true);
  });

  test("superadmin selected shop catalog calls products with shop_id", async ({ page }) => {
    const productUrls: string[] = [];
    await seedSession(page, "superadmin");
    await mockShellApis(page, productUrls);
    await page.goto("/admin/products");

    await page.getByLabel("Shop", { exact: true }).selectOption("2");

    await expect
      .poll(() => productUrls.some((url) => new URL(url).searchParams.get("shop_id") === "2"))
      .toBe(true);
  });

  test("superadmin catalog defaults to sidebar-selected acting shop", async ({ page }) => {
    const productUrls: string[] = [];
    await seedSession(page, "superadmin", 2);
    await mockShellApis(page, productUrls);

    await page.goto("/admin/products");

    await expect(page.getByLabel("Shop", { exact: true })).toHaveValue("2");
    await expect
      .poll(() => productUrls.some((url) => new URL(url).searchParams.get("shop_id") === "2"))
      .toBe(true);
  });

  test("superadmin write workflows still require a sidebar-selected acting shop", async ({
    page,
  }) => {
    await seedSession(page, "superadmin");
    await mockShellApis(page);
    await page.goto("/admin/products");

    await page.getByRole("button", { name: "New product" }).click();
    await page.getByLabel("Barcode").fill("NEW-001");
    await page.getByLabel("Brand").fill("New Brand");
    await page.getByLabel("Size label").fill("750ml");
    await page.getByLabel("Price").fill("500");
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByRole("alert")).toContainText("Pick a shop first");

    await page.getByRole("button", { name: "Bulk import" }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "products.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("barcode,brand,size_label,price\nA,B,750ml,1\n"),
    });
    await page.getByRole("button", { name: "Upload CSV" }).click();
    await expect(page.getByRole("alert")).toContainText("Pick a shop first");

    await page.getByRole("button", { name: "Copy products" }).click();
    await page.getByRole("button", { name: "Copy into selected shop" }).click();
    await expect(page.getByRole("alert")).toContainText("Pick a shop first");
  });

  test("product actions require typed confirmation and show hard delete only when eligible", async ({
    page,
  }) => {
    await seedSession(page, "superadmin");
    await mockShellApis(page);

    let archiveBody: Record<string, unknown> | null = null;
    await page.route("**/products/1/archive", async (route) => {
      archiveBody = route.request().postDataJSON() as Record<string, unknown>;
      products[0].is_active = false;
      products[0].can_permanently_delete = true;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(products[0]) });
    });

    await page.goto("/admin/products");

    const activeRow = page.locator("tbody tr").filter({ hasText: "Central Brand" });
    const inactiveRow = page.locator("tbody tr").filter({ hasText: "North Brand" });

    await expect(activeRow.getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(inactiveRow.getByRole("button", { name: "Restore" })).toBeVisible();
    await expect(inactiveRow.getByRole("button", { name: "Permanently delete" })).toBeVisible();

    await activeRow.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete product" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Delete" })).toBeDisabled();
    await dialog.getByRole("textbox").fill("DELETE");
    await dialog.getByRole("button", { name: "Delete" }).click();

    await expect.poll(() => archiveBody?.confirmation_text).toBe("DELETE");
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
  });
});
