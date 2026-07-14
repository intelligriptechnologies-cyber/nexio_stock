import { expect, test, type Page } from "@playwright/test";
import { loginAsOwner } from "./helpers/login";

type Role = "owner" | "superadmin";

const stockLots = [
  {
    id: 901,
    shop_id: 1,
    vendor_id: 11,
    received_by_user_id: 7,
    purchase_date: "2026-07-10",
    vendor_invoice_number: "INV-901",
    invoice_value: "1520.00",
    reference: "REF-901",
    notes: "Warehouse rack 4",
    status: "completed",
    approved_by_user_id: 2,
    rejected_by_user_id: null,
    lot_id: null,
    created_by_name: "Maya Singh",
    approved_by_name: "Ravi Kumar",
    rejected_by_name: null,
    approved_at: "2026-07-10T09:15:00.000Z",
    rejected_at: null,
    completed_at: "2026-07-10T10:20:00.000Z",
    received_at: "2026-07-10T08:45:00.000Z",
    created_at: "2026-07-10T08:40:00.000Z",
    updated_at: "2026-07-10T10:20:00.000Z",
    vendor: {
      id: 11,
      shop_id: 1,
      name: "Everest Distributors",
      gstin: "27AAAAA0000A1Z5",
      address: "Industrial Area",
      email: "vendor@example.com",
      phone: "+15555550011",
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    lines: [
      {
        id: 9001,
        product_id: 31,
        quantity: 10,
        good_condition_quantity: 9,
        breakage_quantity: 1,
        product_brand: "Royal Stag",
        product_size_label: "750ml",
      },
      {
        id: 9002,
        product_id: 32,
        quantity: 8,
        good_condition_quantity: 8,
        breakage_quantity: 0,
        product_brand: "Signature",
        product_size_label: "375ml",
      },
    ],
  },
  {
    id: 902,
    shop_id: 1,
    vendor_id: 12,
    received_by_user_id: 8,
    purchase_date: "2026-07-11",
    vendor_invoice_number: "INV-902",
    invoice_value: "840.00",
    reference: null,
    notes: null,
    status: "pending",
    approved_by_user_id: null,
    rejected_by_user_id: null,
    lot_id: null,
    created_by_name: "Asha Patel",
    approved_by_name: null,
    rejected_by_name: null,
    approved_at: null,
    rejected_at: null,
    completed_at: null,
    received_at: "2026-07-11T11:05:00.000Z",
    created_at: "2026-07-11T11:00:00.000Z",
    updated_at: "2026-07-11T11:00:00.000Z",
    vendor: {
      id: 12,
      shop_id: 1,
      name: "Nimbus Suppliers",
      gstin: null,
      address: "Depot 2",
      email: null,
      phone: null,
      is_active: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    lines: [
      {
        id: 9003,
        product_id: 33,
        quantity: 4,
        good_condition_quantity: 4,
        breakage_quantity: 0,
        product_brand: "Blenders Pride",
        product_size_label: "1L",
      },
    ],
  },
] as const;

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

async function seedSession(page: Page, role: Role, actingShopId: number | null = 1) {
  await page.addInitScript(
    ({ seededRole, token, seededActingShopId }) => {
      sessionStorage.setItem("barstock.token", token);
      sessionStorage.setItem(
        "barstock.user",
        JSON.stringify({
          id: 1,
          shopId: seededRole === "superadmin" ? null : 1,
          role: seededRole,
          username: seededRole,
          fullName: seededRole === "superadmin" ? "Superadmin" : "Owner",
          phone: "0000000000",
        })
      );
      if (seededActingShopId !== null) {
        sessionStorage.setItem("barstock.actingShopId", String(seededActingShopId));
      }
    },
    { seededRole: role, token: tokenFor(role), seededActingShopId: actingShopId }
  );
}

async function mockStockTrackingApis(page: Page) {
  const settings = {
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
  };

  await page.route("**/settings/me**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(settings) });
  });

  await page.route("**/products/pending/count**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 0 }) });
  });

  await page.route("**/dashboard/void-queue**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ invoices: [] }) });
  });

  await page.route("**/shops**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: 1, name: "Shop One", code: "shop1" },
        { id: 2, name: "Shop Two", code: "shop2" },
      ]),
    });
  });

  await page.route("**/lots**", async (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get("status");
    const lots = status ? stockLots.filter((lot) => lot.status === status) : stockLots;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ lots }),
    });
  });
}

test.describe("stock tracking", () => {
  test("owner sees summary rows and can open the dialog from a row", async ({ page }) => {
    await mockStockTrackingApis(page);
    await loginAsOwner(page);
    await page.evaluate(() => {
      sessionStorage.setItem("barstock.actingShopId", "1");
    });

    await page.goto("/admin/stock-tracking");

    await expect(page.getByRole("heading", { name: "Stock Tracking" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Stock tracking table" })).toBeVisible();
    await expect(page.getByText("Royal Stag")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open inward 901 details" })).toBeVisible();
    await expect(page.getByRole("button", { name: "View inward 901 details" })).toBeVisible();

    await page.getByRole("button", { name: "Open inward 901 details" }).click();

    const dialog = page.getByRole("dialog", { name: "Inward #901" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("table", { name: "Inward 901 line items" })).toBeVisible();
    await expect(dialog).toContainText("Everest Distributors");
    await expect(dialog).toContainText("INV-901");
    await expect(dialog).toContainText("REF-901");
    await expect(dialog).toContainText("Warehouse rack 4");
    await expect(dialog).toContainText("Royal Stag");
    await expect(dialog).toContainText("Signature");
    await expect(dialog).toContainText("Created at");
    await expect(dialog).toContainText("Updated at");

    const createdAt = await page.evaluate((value) => new Date(value).toLocaleString(), stockLots[0].created_at);
    const receivedAt = await page.evaluate((value) => new Date(value).toLocaleString(), stockLots[0].received_at);
    await expect(dialog).toContainText(createdAt);
    await expect(dialog).toContainText(receivedAt);

    await dialog.click({ position: { x: 8, y: 8 } });
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "Open inward 901 details" }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open inward 901 details" })).toBeFocused();
  });

  test("superadmin can use the View button to open a dialog with timestamps and lines", async ({
    page,
  }) => {
    await seedSession(page, "superadmin", 1);
    await mockStockTrackingApis(page);

    await page.goto("/admin/stock-tracking");

    await expect(page.getByRole("heading", { name: "Stock Tracking" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Stock tracking table" })).toBeVisible();
    await expect(page.getByRole("button", { name: "View inward 902 details" })).toBeVisible();

    await page.getByRole("button", { name: "View inward 902 details" }).click();

    const dialog = page.getByRole("dialog", { name: "Inward #902" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Nimbus Suppliers");
    await expect(dialog).toContainText("INV-902");
    await expect(dialog).toContainText("Blenders Pride");
    await expect(dialog).toContainText("1L");
    await expect(dialog).toContainText("Notes");
    await expect(dialog).toContainText("--");

    const purchaseDate = await page.evaluate((value) => new Date(value).toLocaleDateString(), stockLots[1].purchase_date);
    const createdAt = await page.evaluate((value) => new Date(value).toLocaleString(), stockLots[1].created_at);
    await expect(dialog).toContainText(purchaseDate);
    await expect(dialog).toContainText(createdAt);

    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(dialog).toHaveCount(0);
  });
});
