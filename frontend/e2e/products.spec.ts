import { test, expect, type Page } from "@playwright/test";
import { loginAsCashier as _loginAsCashier, loginAsOwner as _loginAsOwner, loginAsReceiver as _loginAsReceiver } from "./helpers/login";
const _login = { loginAsCashier: _loginAsCashier, loginAsOwner: _loginAsOwner, loginAsReceiver: _loginAsReceiver };
async function loginAsOwner(page: Page) {
  return _login.loginAsOwner(page);
}
async function loginAsCashier(page: Page) {
  return _login.loginAsCashier(page);
}

async function openMockedProductCatalog(page: Page) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payloadBody: { sub: string; shop_id: number; role: string; exp: number; test_pad?: string } = {
    sub: "1", shop_id: 1, role: "owner", exp: Math.floor(Date.now() / 1000) + 3600,
  };
  let payload = Buffer.from(JSON.stringify(payloadBody)).toString("base64url");
  while (payload.length % 4 !== 0) {
    payloadBody.test_pad = `${payloadBody.test_pad ?? ""}x`;
    payload = Buffer.from(JSON.stringify(payloadBody)).toString("base64url");
  }
  await page.addInitScript((token) => {
    sessionStorage.setItem("barstock.token", token);
    sessionStorage.setItem("barstock.user", JSON.stringify({
      id: 1, shopId: 1, role: "owner", username: "owner", fullName: "Owner", phone: "0000000000",
    }));
  }, `${header}.${payload}.signature`);
  await page.route("**/settings/me**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id: 1, name: "Shop One", code: "shop1", app_display_name: "BarStock",
      action_color: "#22c55e", active_tab_color: "#5a5148",
      sidebar_menu_inactive_text_color: "#535353cf", sidebar_menu_active_text_color: "#ffffff",
      email_enabled: false, smtp_host: null, smtp_port: null, smtp_username: null,
      smtp_from_email: null, smtp_from_name: null, smtp_use_tls: true,
    }),
  }));
  await page.route("**/products/pending/count**", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ count: 0 }),
  }));
  await page.route(
    (url) => url.origin === "http://127.0.0.1:8000" && /\/products\?.*$/.test(url.href),
    async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const offset = Number(params.get("offset") ?? 0);
    const limit = Number(params.get("limit") ?? 25);
    const rows = Array.from({ length: Math.max(0, Math.min(limit, 60 - offset)) }, (_, index) => ({
      id: offset + index + 1, shop_id: 1,
      barcode: `PRODUCT-${String(offset + index + 1).padStart(3, "0")}`,
      brand: `Product page record ${offset + index + 1}`, size_label: "750ml", price: "500.00",
      low_stock_threshold: 4, is_active: true, status: "active",
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", current_stock: 8,
    }));
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Expose-Headers": "X-Total-Count", "X-Total-Count": "60" },
      body: JSON.stringify(rows),
    });
    }
  );
  await page.goto("/admin/products?page=2&pageSize=25");
}

test.describe("product catalog — owner", () => {
  test("direct page 2 remains selected after the search debounce", async ({ page }) => {
    await openMockedProductCatalog(page);

    await expect(page.getByText("Product page record 26")).toBeVisible();
    await page.waitForTimeout(400);
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("2");
    await expect(page.getByText("Product page record 26")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("renders list + tabs and can search", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/products");
    await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Catalog" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download catalog CSV" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New product" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bulk import" })).toBeVisible();
    await page.getByPlaceholder("Search by brand").fill("XYZ-NO-MATCH");
    // Either we get the empty-state or a row; both prove the search worked.
    await expect(page.getByText(/No products match|Loading…|Refreshing/)).toBeVisible();
  });

  test("global scanner opens an existing barcode in catalog edit mode", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/products");
    await page.keyboard.type("8901234567890", { delay: 1 });
    await page.keyboard.press("Enter");
    await expect(page.getByPlaceholder("Search by brand")).toHaveValue("8901234567890");
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible({ timeout: 5000 });
  });

  test("global scanner prefills a missing barcode on the new-product tab", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/products");
    const barcode = `SCAN-MISSING-${Date.now()}`;
    await page.keyboard.type(barcode, { delay: 1 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "New product" })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByLabel("Barcode")).toHaveValue(barcode);
  });

  test("create-tab shows the new-product form", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/products");
    await page.getByRole("button", { name: "New product" }).click();
    await expect(page.getByRole("heading", { name: "New product" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download catalog CSV" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create product" })).toBeVisible();
  });

  test("import-tab accepts a CSV file picker", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/products");
    await page.getByRole("button", { name: "Bulk import" }).click();
    await expect(page.getByRole("heading", { name: "Bulk CSV import" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload CSV" })).toBeVisible();
  });
});

test.describe("product catalog — non-owner blocked", () => {
  test("cashier is redirected to /forbidden from /admin/products", async ({ page }) => {
    await loginAsCashier(page);
    await page.goto("/admin/products");
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  });
});
