import { expect, test, type Page } from "@playwright/test";

type Shop = {
  id: number;
  name: string;
  code: string;
  gstin: string | null;
  excise_duty_rate: string | null;
  low_stock_threshold_default: number | null;
};

const baseShop: Shop = {
  id: 1,
  name: "Shop One",
  code: "shop1",
  gstin: null,
  excise_duty_rate: null,
  low_stock_threshold_default: 5,
};

function tokenForSuperadmin(): string {
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

async function seedSuperadmin(page: Page, actingShopId: number | null = 1) {
  await page.addInitScript(
    ({ token, actingShopId: seededActingShopId }) => {
      sessionStorage.setItem("barstock.token", token);
      sessionStorage.setItem(
        "barstock.user",
        JSON.stringify({
          id: 1,
          shopId: null,
          role: "superadmin",
          username: "sa",
          fullName: "Superadmin",
          phone: "0000000000",
        })
      );
      if (seededActingShopId !== null) {
        sessionStorage.setItem("barstock.actingShopId", String(seededActingShopId));
      }
    },
    { token: tokenForSuperadmin(), actingShopId }
  );
}

async function mockShopMaintenanceApis(page: Page) {
  let shops: Shop[] = [{ ...baseShop }];
  const isApi = (url: URL) => url.origin === "http://127.0.0.1:8000";

  await page.route("**/settings/me**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...baseShop,
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
      }),
    });
  });

  await page.route("**/products/pending/count**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 0 }) });
  });

  await page.route((url) => isApi(url) && /\/shops\/me(?:\?.*)?$/.test(url.href), async (route) => {
    const url = new URL(route.request().url());
    const shopId = Number(url.searchParams.get("shop_id") ?? shops[0].id);
    const shop = shops.find((row) => row.id === shopId) ?? shops[0];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(shop) });
  });

  await page.route((url) => isApi(url) && /\/shops\/\d+\/users$/.test(url.href), async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 10,
          shop_id: 1,
          role: "owner",
          username: "owner1",
          full_name: "Owner One",
          phone: "9999999999",
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
        },
      ]),
    });
  });

  await page.route("**/products?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 20,
          shop_id: 1,
          barcode: "CHK-001",
          brand: "Check Brand",
          size_label: "750ml",
          price: "500.00",
          low_stock_threshold: 4,
          is_active: true,
          status: "active",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          current_stock: 8,
        },
      ]),
    });
  });

  await page.route((url) => isApi(url) && /\/shops\/\d+$/.test(url.href), async (route) => {
    const request = route.request();
    const id = Number(new URL(request.url()).pathname.split("/").pop());
    const payload = request.postDataJSON() as Partial<Shop>;
    shops = shops.map((shop) => (shop.id === id ? { ...shop, ...payload } : shop));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(shops.find((shop) => shop.id === id)),
    });
  });

  await page.route((url) => isApi(url) && /\/shops(?:\?.*)?$/.test(url.href), async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const payload = request.postDataJSON() as Pick<Shop, "name" | "code">;
      const created = {
        ...baseShop,
        id: 2,
        name: payload.name,
        code: payload.code,
      };
      shops = [...shops, created];
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(created) });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(shops.map(({ id, name, code }) => ({ id, name, code }))),
    });
  });
}

test.describe("shop maintenance", () => {
  test("uses tabs and refreshes shop lists after create and update", async ({ page }) => {
    await seedSuperadmin(page);
    await mockShopMaintenanceApis(page);

    await page.goto("/admin/shops");

    await expect(page.getByRole("heading", { name: "Shop Management" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Shop Details" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Allotted Users" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Quick Inventory Check" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Shop One/ })).toHaveAttribute("aria-current", "true");

    await page.getByRole("tab", { name: "Allotted Users" }).click();
    await expect(page.getByText("Owner One")).toBeVisible();
    await expect(page.getByRole("button", { name: /Shop One/ })).toHaveAttribute("aria-current", "true");

    await page.getByRole("tab", { name: "Quick Inventory Check" }).click();
    await expect(page.getByText("Check Brand")).toBeVisible();
    await expect(page.getByRole("button", { name: /Shop One/ })).toHaveAttribute("aria-current", "true");

    await page.getByLabel("Name").first().fill("Shop Two");
    await page.getByLabel("Code").first().fill("shop2");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("button", { name: /Shop Two/ })).toHaveAttribute("aria-current", "true");
    await expect(page.getByLabel("Working shop")).toContainText("Shop Two (shop2)");

    await page.getByRole("tab", { name: "Shop Details" }).click();
    await page.getByLabel("Name").nth(1).fill("Shop Two Updated");
    await page.getByLabel("Code").nth(1).fill("shop2u");
    await page.getByRole("button", { name: "Save shop" }).click();

    await expect(page.getByRole("button", { name: /Shop Two Updated/ })).toHaveAttribute(
      "aria-current",
      "true"
    );
    await expect(page.getByLabel("Working shop")).toContainText("Shop Two Updated (shop2u)");
  });
});
