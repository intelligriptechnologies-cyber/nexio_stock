import { expect, test, type Page } from "@playwright/test";

type Shop = {
  id: number;
  name: string;
  code: string;
  gstin: string | null;
  excise_duty_rate: string | null;
  low_stock_threshold_default: number | null;
  allowed_login_cidrs: string[];
  current_business_date?: string;
  cashier_login_restriction_enabled?: boolean;
  receiving_vendor_link_enabled?: boolean;
};

type ShopTwoFactorState = {
  shop_id: number;
  two_factor_enabled: boolean;
  two_factor_secret_version: number | null;
  two_factor_rotated_at: string | null;
  two_factor_required_for_roles: string[];
  has_active_secret: boolean;
};

type ActivationRecord = {
  id: number;
  shop_id: number;
  secret_version: number;
  machine_label: string | null;
  is_active: boolean;
  activated_at: string;
  last_seen_at: string | null;
  deactivated_at: string | null;
};

const API_ORIGIN = "http://127.0.0.1:8000";

const baseShop: Shop = {
  id: 1,
  name: "Shop One",
  code: "shop1",
  gstin: null,
  excise_duty_rate: null,
  low_stock_threshold_default: 5,
  allowed_login_cidrs: [],
  current_business_date: "2026-07-27",
  cashier_login_restriction_enabled: false,
  receiving_vendor_link_enabled: true,
};

function tokenFor(role: string, shopId: number | null): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "1",
      shop_id: shopId,
      role,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString("base64url");
  return `${header}.${payload}.signature`;
}

async function seedSuperadmin(page: Page, actingShopId = 1) {
  await page.addInitScript(
    ({ token, seededActingShopId }) => {
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
      sessionStorage.setItem("barstock.actingShopId", String(seededActingShopId));
    },
    { token: tokenFor("superadmin", null), seededActingShopId: actingShopId }
  );
}

async function mockTwoFactorShopMaintenanceApis(page: Page) {
  let shops: Shop[] = [{ ...baseShop }];
  let shopTwoFactor: ShopTwoFactorState = {
    shop_id: 1,
    two_factor_enabled: false,
    two_factor_secret_version: null,
    two_factor_rotated_at: null,
    two_factor_required_for_roles: ["owner", "cashier_user", "receiver_user"],
    has_active_secret: false,
  };
  let devices = [
    {
      id: 101,
      shop_id: 1,
      device_key: "browser-terminal-01",
      counter_name: "Counter 1",
      is_active: true,
      created_at: "2026-07-20T09:00:00Z",
      updated_at: "2026-07-20T09:00:00Z",
    },
  ];
  let activations: ActivationRecord[] = [
    {
      id: 201,
      shop_id: 1,
      secret_version: 1,
      machine_label: "Front Desk PC",
      is_active: true,
      activated_at: "2026-07-20T09:00:00Z",
      last_seen_at: "2026-07-27T08:00:00Z",
      deactivated_at: null,
    },
  ];
  let lastActivationToken = {
    activation_token: "activate-shop-one-123456",
    expires_at: "2026-07-27T12:30:00Z",
    shop_id: 1,
    secret_version: 2,
  };

  const isApi = (url: URL) => url.origin === API_ORIGIN;

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

  await page.route("**/users/me", async (route) => {
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
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      }),
    });
  });

  await page.route((url) => {
    const parsed = new URL(url);
    return parsed.origin === API_ORIGIN && parsed.pathname === "/users/me/two-factor";
  }, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        two_factor_enabled: false,
        two_factor_secret_version: null,
        two_factor_rotated_at: null,
        has_active_secret: false,
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
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });

  await page.route("**/products?**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });

  await page.route((url) => isApi(url) && /\/shops\/\d+\/two-factor$/.test(url.href), async (route) => {
    const request = route.request();
    if (request.method() === "PATCH") {
      const payload = request.postDataJSON() as { two_factor_enabled: boolean };
      shopTwoFactor = { ...shopTwoFactor, two_factor_enabled: payload.two_factor_enabled };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(shopTwoFactor) });
  });

  await page.route((url) => isApi(url) && /\/shops\/\d+\/two-factor\/secret$/.test(url.href), async (route) => {
    shopTwoFactor = {
      ...shopTwoFactor,
      has_active_secret: true,
      two_factor_secret_version: 1,
      two_factor_rotated_at: "2026-07-27T09:00:00Z",
    };
    activations = activations.map((activation) => ({ ...activation, secret_version: 1 }));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(shopTwoFactor) });
  });

  await page.route(
    (url) => isApi(url) && /\/shops\/\d+\/two-factor\/secret\/rotate$/.test(url.href),
    async (route) => {
      shopTwoFactor = {
        ...shopTwoFactor,
        has_active_secret: true,
        two_factor_secret_version: (shopTwoFactor.two_factor_secret_version ?? 0) + 1,
        two_factor_rotated_at: "2026-07-27T10:00:00Z",
      };
      lastActivationToken = { ...lastActivationToken, secret_version: shopTwoFactor.two_factor_secret_version ?? 1 };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(shopTwoFactor) });
    }
  );

  await page.route(
    (url) => isApi(url) && /\/shops\/\d+\/two-factor\/activation-tokens$/.test(url.href),
    async (route) => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(lastActivationToken) });
    }
  );

  await page.route(
    (url) => isApi(url) && /\/shops\/\d+\/two-factor\/authenticator-activations(?:\?.*)?$/.test(url.href),
    async (route) => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(activations) });
    }
  );

  await page.route(
    (url) => isApi(url) && /\/shops\/\d+\/two-factor\/authenticator-activations\/\d+$/.test(url.href),
    async (route) => {
      const activationId = Number(new URL(route.request().url()).pathname.split("/").pop());
      const payload = route.request().postDataJSON() as { is_active: boolean };
      activations = activations.map((activation) =>
        activation.id === activationId
          ? {
              ...activation,
              is_active: payload.is_active,
              deactivated_at: payload.is_active ? null : "2026-07-27T10:15:00Z",
            }
          : activation
      );
      const activation = activations.find((row) => row.id === activationId);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(activation) });
    }
  );

  await page.route((url) => isApi(url) && /\/shops\/me\/devices(?:\?.*)?$/.test(url.href), async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(devices) });
  });

  await page.route(
    (url) => isApi(url) && /\/shops\/me\/devices\/\d+(?:\?.*)?$/.test(url.href),
    async (route) => {
      const deviceId = Number(new URL(route.request().url()).pathname.split("/").pop());
      const payload = route.request().postDataJSON() as { is_active?: boolean };
      devices = devices.map((device) =>
        device.id === deviceId
          ? { ...device, is_active: payload.is_active ?? device.is_active, updated_at: "2026-07-27T10:10:00Z" }
          : device
      );
      const device = devices.find((row) => row.id === deviceId);
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(device) });
    }
  );

  await page.route((url) => isApi(url) && /\/shops(?:\?.*)?$/.test(url.href), async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(shops.map(({ id, name, code }) => ({ id, name, code }))),
    });
  });

  await page.route((url) => isApi(url) && /\/shops\/\d+$/.test(url.href), async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split("/").pop());
    const shop = shops.find((row) => row.id === id) ?? shops[0];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(shop) });
  });
}

async function mockSuperadminSettingsApis(page: Page) {
  let twoFactorState = {
    two_factor_enabled: false,
    two_factor_secret_version: null as number | null,
    two_factor_rotated_at: null as string | null,
    has_active_secret: false,
  };

  await page.route("**/products/pending/count**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 0 }) });
  });

  await page.route("**/settings/me**", async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ...baseShop,
          app_display_name: String(payload.app_display_name ?? "BarStock"),
          action_color: String(payload.action_color ?? "#22c55e"),
          active_tab_color: String(payload.active_tab_color ?? "#5a5148"),
          sidebar_menu_inactive_text_color: String(payload.sidebar_menu_inactive_text_color ?? "#535353cf"),
          sidebar_menu_active_text_color: String(payload.sidebar_menu_active_text_color ?? "#ffffff"),
          email_enabled: false,
          smtp_host: null,
          smtp_port: null,
          smtp_username: null,
          smtp_from_email: null,
          smtp_from_name: null,
          smtp_use_tls: true,
          receiving_vendor_link_enabled: true,
        }),
      });
      return;
    }
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
        receiving_vendor_link_enabled: true,
      }),
    });
  });

  await page.route((url) => {
    const parsed = new URL(url);
    return parsed.origin === API_ORIGIN && parsed.pathname === "/users/me/two-factor/secret/rotate";
  }, async (route) => {
    twoFactorState = {
      ...twoFactorState,
      has_active_secret: true,
      two_factor_enabled: true,
      two_factor_secret_version: (twoFactorState.two_factor_secret_version ?? 0) + 1,
      two_factor_rotated_at: "2026-07-27T11:00:00Z",
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        secret_version: twoFactorState.two_factor_secret_version,
        rotated_at: twoFactorState.two_factor_rotated_at,
      }),
    });
  });

  await page.route("**/users/me/two-factor**", async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = route.request().postDataJSON() as {
        two_factor_enabled: boolean;
      };
      twoFactorState = {
        ...twoFactorState,
        two_factor_enabled: payload.two_factor_enabled,
        has_active_secret: payload.two_factor_enabled ? true : twoFactorState.has_active_secret,
        two_factor_secret_version:
          payload.two_factor_enabled && twoFactorState.two_factor_secret_version == null
            ? 1
            : twoFactorState.two_factor_secret_version,
        two_factor_rotated_at:
          payload.two_factor_enabled && twoFactorState.two_factor_rotated_at == null
            ? "2026-07-27T10:45:00Z"
            : twoFactorState.two_factor_rotated_at,
      };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(twoFactorState) });
  });

  await page.route("**/users/me", async (route) => {
    if (route.request().method() === "PATCH") {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          shop_id: null,
          role: "superadmin",
          username: "sa",
          full_name: "Superadmin",
          phone: String(payload.phone ?? "0000000000"),
          email: payload.email ?? null,
          date_of_birth: payload.date_of_birth ?? null,
          pan: payload.pan ?? null,
          gstin: payload.gstin ?? null,
          is_active: true,
          created_at: "2026-01-01T00:00:00Z",
        }),
      });
      return;
    }
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
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      }),
    });
  });

  await page.route("**/users/me/password", async (route) => {
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
        is_active: true,
        created_at: "2026-01-01T00:00:00Z",
      }),
    });
  });
}

test.describe("two-factor authentication", () => {
  test("shop login shows the access-key step and completes verification", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("barstock.deviceKey", "test-terminal-01");
    });

    await page.route("**/auth/login", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          auth_status: "two_factor_required",
          challenge_token: "challenge-shop-123",
          expires_in: 300,
          factor_type: "shop_access_key",
          user: {
            id: 11,
            role: "cashier_user",
            full_name: "Cashier One",
          },
          shop: {
            id: 1,
            name: "Shop One",
            code: "shop1",
          },
        }),
      });
    });

    await page.route("**/auth/verify-2fa", async (route) => {
      const payload = route.request().postDataJSON() as { access_key: string; device_key?: string };
      expect(payload.access_key).toBe("654321");
      expect(payload.device_key).toBe("test-terminal-01");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          access_token: tokenFor("cashier_user", 1),
          token_type: "bearer",
          expires_in: 3600,
          user: {
            id: 11,
            shop_id: 1,
            role: "cashier_user",
            username: "cashier1",
            full_name: "Cashier One",
            phone: "9999999999",
          },
        }),
      });
    });

    await page.route("**/products?**", async (route) => {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
    });

    await page.goto("/login");
    await page.getByRole("radio", { name: "Cashier" }).check({ force: true });
    await page.getByLabel("Terminal ID / Username").fill("cashier1");
    await page.getByLabel("Security PIN").fill("cashpass");
    await page.getByRole("button", { name: "Open Terminal", exact: true }).click();

    await expect(page.getByText("Enter Access Key")).toBeVisible();
    await expect(page.getByText("Shop One (shop1)")).toBeVisible();
    await page.getByLabel("6-Digit Access Key").fill("654321");
    await page.getByRole("button", { name: "Verify Access Key" }).click();

    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  });

  test("shop master two-factor tab manages secrets, activation tokens, and device state", async ({ page }) => {
    await seedSuperadmin(page);
    await mockTwoFactorShopMaintenanceApis(page);

    await page.goto("/admin/shops");
    await expect(page.getByRole("heading", { name: "Shop Master" })).toBeVisible();

    await page.getByRole("tab", { name: "Two Factor Authentication" }).click();
    await expect(page.getByText("Protected roles")).toBeVisible();
    await expect(page.getByText("Owner, Cashier, Receiver")).toBeVisible();
    await expect(page.getByText("Not generated")).toHaveCount(2);

    await page.getByRole("button", { name: "Generate Secret" }).click();
    await expect(page.getByText("Two-factor settings updated.")).toBeVisible();
    await expect(page.getByText("Enabled")).toHaveCount(0);
    await expect(page.getByText("Disable 2FA")).toHaveCount(0);
    await expect(
      page.getByText("Secret version", { exact: true }).locator("..").getByText("1", { exact: true })
    ).toBeVisible();

    await page.getByRole("button", { name: "Enable 2FA" }).click();
    await expect(page.getByRole("button", { name: "Disable 2FA" })).toBeVisible();

    await page.getByRole("button", { name: "Create Activation Token" }).click();
    await expect(page.getByText("One-time activation token", { exact: true })).toBeVisible();
    await expect(page.getByText("activate-shop-one-123456")).toBeVisible();

    await page.getByRole("button", { name: "Deactivate" }).first().click();
    await expect(page.getByRole("button", { name: "Activate" }).first()).toBeVisible();

    await page.getByRole("button", { name: "Deactivate" }).nth(0).click();
    await expect(page.getByRole("button", { name: "Activate" })).toHaveCount(2);
  });

  test("superadmin settings page manages personal two-factor state", async ({ page }) => {
    await seedSuperadmin(page);
    await mockSuperadminSettingsApis(page);

    await page.goto("/admin/settings");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Security" }).click();

    await expect(page.getByRole("heading", { name: "Security", exact: true })).toBeVisible();
    await expect(page.getByLabel("Status")).toHaveValue("Disabled");
    await expect(page.getByRole("button", { name: "Enable 2FA" })).toBeVisible();

    await page.getByRole("button", { name: "Enable 2FA" }).click();
    await expect(page.getByRole("status")).toContainText("Superadmin two-factor enabled.");
    await expect(page.getByLabel("Status")).toHaveValue("Enabled");
    await expect(page.getByLabel("Secret Version")).toHaveValue("1");

    await page.getByRole("button", { name: "Rotate Secret" }).click();
    await expect(page.getByRole("status")).toContainText("Superadmin two-factor secret rotated.");

    await page.getByRole("textbox", { name: /^Current Password/ }).fill("adminpass");
    await page.getByRole("button", { name: "Disable 2FA" }).click();
    await expect(page.getByRole("status")).toContainText("Superadmin two-factor disabled.");
    await expect(page.getByLabel("Status")).toHaveValue("Disabled");
  });
});
