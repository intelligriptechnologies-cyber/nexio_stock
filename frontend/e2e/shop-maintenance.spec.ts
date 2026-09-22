import { expect, test, type Page } from "@playwright/test";

type Shop = {
  id: number;
  name: string;
  code: string;
  gstin: string | null;
  excise_duty_rate: string | null;
  low_stock_threshold_default: number | null;
  allowed_login_cidrs: string[];
};

const baseShop: Shop = {
  id: 1,
  name: "Shop One",
  code: "shop1",
  gstin: null,
  excise_duty_rate: null,
  low_stock_threshold_default: 5,
  allowed_login_cidrs: [],
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
      } else {
        sessionStorage.removeItem("barstock.actingShopId");
      }
    },
    { token: tokenForSuperadmin(), actingShopId }
  );
}

async function mockShopMaintenanceApis(page: Page, productTotal?: number) {
  let shops: Shop[] = [{ ...baseShop }];
  const resetPasswordCalls: Array<{ shopId: number; userId: number; password: string }> = [];
  const productUrls: string[] = [];
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
        allowed_login_cidrs: [],
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

  await page.route("**/users/me**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: 1,
        shop_id: null,
        role: "superadmin",
        username: "sa",
        full_name: "Superadmin",
        phone: "0000000000",
        email: null,
        date_of_birth: null,
        pan: null,
        gstin: null,
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

  await page.route((url) => isApi(url) && /\/shops\/\d+\/users(?:\?.*)?$/.test(url.href), async (route) => {
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

  await page.route((url) => isApi(url) && /\/shops\/\d+\/two-factor$/.test(url.href), async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      two_factor_enabled: false, two_factor_secret_version: null,
      two_factor_rotated_at: null, has_active_secret: false,
    }) });
  });

  await page.route((url) => isApi(url) && /\/shops\/me\/devices(?:\?.*)?$/.test(url.href), async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });

  await page.route(
    (url) => isApi(url) && /\/shops\/\d+\/two-factor\/authenticator-activations(?:\?.*)?$/.test(url.href),
    async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([]) })
  );

  await page.route(
    (url) => isApi(url) && /\/shops\/\d+\/users\/\d+\/password$/.test(url.href),
    async (route) => {
      const request = route.request();
      const match = new URL(request.url()).pathname.match(/\/shops\/(\d+)\/users\/(\d+)\/password$/);
      const payload = request.postDataJSON() as { password: string };
      resetPasswordCalls.push({
        shopId: Number(match?.[1]),
        userId: Number(match?.[2]),
        password: payload.password,
      });
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: 10,
          shop_id: 1,
          role: "owner",
          username: "owner1",
          full_name: "Owner One",
          phone: "9999999999",
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
        }),
      });
    }
  );

  await page.route("**/products?**", async (route) => {
    productUrls.push(route.request().url());
    await route.fulfill({
      contentType: "application/json",
      headers: productTotal == null ? undefined : {
        "Access-Control-Expose-Headers": "X-Total-Count",
        "X-Total-Count": String(productTotal),
      },
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
      body: JSON.stringify(
        shops.map(({ id, name, code }) => ({ id, name, code }))
      ),
    });
  });

  return { resetPasswordCalls, productUrls };
}

test.describe("shop maintenance", () => {
  test("quick inventory top and bottom pagination stay synchronized", async ({ page }) => {
    await seedSuperadmin(page);
    const { productUrls } = await mockShopMaintenanceApis(page, 60);

    await page.goto("/admin/shops");
    await page.getByRole("tab", { name: "Quick Inventory Check" }).click();

    const top = page.getByRole("navigation", { name: "Quick inventory top pagination" });
    const bottom = page.getByRole("navigation", { name: "Quick inventory bottom pagination" });
    await expect(top).toBeVisible();
    await expect(bottom).toBeVisible();

    await page.getByLabel("Quick inventory top items per page").selectOption("50");
    await expect.poll(() => new URL(page.url()).searchParams.get("inventoryPage")).toBe("1");
    await expect.poll(() => new URL(page.url()).searchParams.get("inventoryPageSize")).toBe("50");
    await expect.poll(() => productUrls.some((raw) => {
      const params = new URL(raw).searchParams;
      return params.get("limit") === "50" && params.get("offset") === "0";
    })).toBe(true);
    await expect(page.getByLabel("Quick inventory bottom items per page")).toHaveValue("50");

    await top.getByRole("button", { name: "Next page" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("inventoryPage")).toBe("2");
    await expect(bottom.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");

    await page.getByRole("tab", { name: "Allotted Users" }).click();
    await expect(page.getByRole("navigation", { name: "Allotted users top pagination" })).toHaveCount(0);
  });

  test("sidebar shop picker shows explicit empty state before a shop is selected", async ({ page }) => {
    await seedSuperadmin(page, null);
    await mockShopMaintenanceApis(page);

    await page.goto("/admin/settings");

    const status = page.getByTestId("shop-picker-status");
    await expect(status).toHaveText("Select before edit/billing");
    await expect(status).not.toHaveText("Working shop");
    await expect(page.getByLabel("Working shop")).toHaveValue("");
    await expect(page.getByLabel("Working shop")).toContainText("Select working shop");
  });

  test("uses tabs and refreshes shop lists after create and update", async ({ page }) => {
    await seedSuperadmin(page);
    await mockShopMaintenanceApis(page);

    await page.goto("/admin/shops");

    await expect(page.getByRole("heading", { name: "Shop Master" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Shop Master" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Staff" })).toHaveCount(0);
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
    await expect(page.getByTestId("shop-picker-status")).toHaveText("Working shop");
    await expect(page.getByTestId("shop-picker-status")).not.toContainText("Shop Two (shop2)");
    await expect(page.getByLabel("Working shop")).toContainText("Shop Two (shop2)");

    await page.getByRole("tab", { name: "Shop Details" }).click();
    await page.getByLabel("Name").nth(1).fill("Shop Two Updated");
    await page.getByLabel("Code").nth(1).fill("shop2u");
    await page.getByRole("button", { name: "Save shop" }).click();

    await expect(page.getByRole("button", { name: /Shop Two Updated/ })).toHaveAttribute(
      "aria-current",
      "true"
    );
    await expect(page.getByTestId("shop-picker-status")).toHaveText("Working shop");
    await expect(page.getByTestId("shop-picker-status")).not.toContainText("Shop Two Updated (shop2u)");
    await expect(page.getByLabel("Working shop")).toContainText("Shop Two Updated (shop2u)");
  });

  test("resets a shop user password through an in-app dialog", async ({ page }) => {
    await seedSuperadmin(page);
    const { resetPasswordCalls } = await mockShopMaintenanceApis(page);

    await page.addInitScript(() => {
      Object.defineProperty(globalThis, "prompt", {
        configurable: true,
        value: () => {
          const current = Reflect.get(globalThis, "__promptCalls") as number | undefined;
          Reflect.set(globalThis, "__promptCalls", (current ?? 0) + 1);
          return "should-not-be-used";
        },
      });
    });

    await page.goto("/admin/shops");
    await page.getByRole("tab", { name: "Allotted Users" }).click();

    const userRow = page.locator("tr", { hasText: "Owner One" });
    await expect(userRow.getByRole("button", { name: /Reset password/i })).toBeVisible();

    await userRow.getByRole("button", { name: /Reset password/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Owner One (owner1)")).toBeVisible();
    await expect(dialog.getByLabel("New password/PIN")).toBeFocused();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(resetPasswordCalls).toHaveLength(0);

    await userRow.getByRole("button", { name: /Reset password/i }).click();
    await dialog.getByLabel("New password/PIN").fill("123");
    await dialog.getByRole("button", { name: "Reset password" }).click();
    await expect(dialog.getByText("Password/PIN must be at least 4 characters.")).toBeVisible();
    expect(resetPasswordCalls).toHaveLength(0);

    await dialog.getByLabel("New password/PIN").fill("1234");
    await dialog.getByRole("button", { name: "Reset password" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("User updated.");
    expect(resetPasswordCalls).toEqual([{ shopId: 1, userId: 10, password: "1234" }]);

    const promptCalls = await page.evaluate(() => {
      return (Reflect.get(globalThis, "__promptCalls") as number | undefined) ?? 0;
    });
    expect(promptCalls).toBe(0);
  });
});
