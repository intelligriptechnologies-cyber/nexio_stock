import { expect, test, type Locator, type Page } from "@playwright/test";

interface MockProduct {
  id: number;
  barcode: string;
  brand: string;
  size_label: string;
  price: string | null;
  is_active: boolean;
  status: "active" | "pending";
  current_stock: number;
}

const firstProduct: MockProduct = {
  id: 101,
  barcode: "LIFO-ALPHA-001",
  brand: "Alpha Reserve",
  size_label: "750ml",
  price: "100.00",
  is_active: true,
  status: "active",
  current_stock: 20,
};

const secondProduct: MockProduct = {
  id: 102,
  barcode: "LIFO-BRAVO-002",
  brand: "Bravo Select",
  size_label: "500ml",
  price: "80.00",
  is_active: true,
  status: "active",
  current_stock: 15,
};

async function mockCatalog(page: Page, products = [firstProduct, secondProduct]) {
  await page.route(/\/products\?/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: { "X-Total-Count": String(products.length) },
      body: JSON.stringify(products),
    });
  });
}

async function setupMockedSession(page: Page, role: "cashier_user" | "receiver_user") {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: "1", shop_id: 1, role, exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString("base64url");

  await page.addInitScript(
    ({ token, userRole }) => {
      sessionStorage.setItem("barstock.token", token);
      sessionStorage.setItem(
        "barstock.user",
        JSON.stringify({
          id: 1,
          shopId: 1,
          role: userRole,
          username: userRole === "cashier_user" ? "cashier1" : "receiver1",
          fullName: userRole === "cashier_user" ? "Cashier One" : "Receiver One",
          phone: "0000000001",
        })
      );
    },
    { token: `${header}.${payload}.signature`, userRole: role }
  );

  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/settings/me") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          app_display_name: "Nexio Stock",
          action_color: "#22c55e",
          active_tab_color: "#5a5148",
          sidebar_menu_inactive_text_color: "#535353cf",
          sidebar_menu_active_text_color: "#ffffff",
        }),
      });
      return;
    }
    if (path === "/shops/me") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          name: "Shop One",
          code: "shop1",
          current_business_date: "2026-09-22",
          cashier_login_restriction_enabled: false,
          receiving_vendor_link_enabled: true,
          allowed_login_cidrs: [],
        }),
      });
      return;
    }
    if (path === "/vendors") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            shop_id: 1,
            name: "LIFO Test Vendor",
            gstin: null,
            address: null,
            email: null,
            phone: null,
            is_active: true,
            created_at: "2026-09-22T00:00:00Z",
            updated_at: "2026-09-22T00:00:00Z",
          },
        ]),
      });
      return;
    }
    if (path === "/healthz") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
      return;
    }
    if (path === "/checkout/validate") {
      const request = route.request().postDataJSON() as { lines: Array<{ barcode: string; quantity: number }> };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          lines: request.lines.map((line) => ({
            barcode: line.barcode,
            requested_quantity: line.quantity,
            available_quantity: 20,
            accepted_quantity: line.quantity,
            adjusted: false,
          })),
        }),
      });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });
}

async function enterBarcode(page: Page, barcode: string) {
  await page.getByPlaceholder("Scan or enter barcode").fill(barcode);
  await page.getByRole("button", { name: "ADD" }).click();
}

function expectLineOrder(lines: Locator, brands: string[]) {
  const rows = lines.locator(":scope > li");
  return Promise.all(brands.map((brand, index) => expect(rows.nth(index)).toContainText(brand)));
}

test("checkout promotes the latest manual, scanned, and searched item and preserves draft order", async ({
  page,
}) => {
  await setupMockedSession(page, "cashier_user");
  await mockCatalog(page);
  await page.goto("/checkout");

  await enterBarcode(page, firstProduct.barcode);
  await page.getByLabel("Note (optional)").focus();
  await page.keyboard.type(secondProduct.barcode, { delay: 1 });
  await page.keyboard.press("Enter");

  const cart = page.getByTestId("checkout-cart-lines");
  await expectLineOrder(cart, [secondProduct.brand, firstProduct.brand]);

  const search = page.getByRole("combobox", {
    name: "Quick-search products by name or barcode",
  });
  await search.fill(firstProduct.brand);
  await page.getByRole("option").filter({ hasText: firstProduct.brand }).click();

  await expectLineOrder(cart, [firstProduct.brand, secondProduct.brand]);
  await expect(cart.locator(":scope > li").first().getByLabel("Quantity", { exact: true })).toHaveValue("2");

  await page.getByRole("button", { name: "Park" }).click();
  await expect(cart.locator(":scope > li")).toHaveCount(1);
  await page.getByRole("button", { name: /Draft .* \(2\)/ }).click();
  await expectLineOrder(cart, [firstProduct.brand, secondProduct.brand]);
  await expect(cart.locator(":scope > li").first().getByLabel("Quantity", { exact: true })).toHaveValue("2");
});

test("checkout uses the same LIFO ordering during an offline session", async ({ page }) => {
  await setupMockedSession(page, "cashier_user");
  await mockCatalog(page);
  await page.route("**/offline-sessions/start", async (route) => {
    const now = new Date();
    const expires = new Date(now.getTime() + 60 * 60 * 1000);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        offline_token: "offline-test-token",
        catalog: [firstProduct, secondProduct].map(
          ({ id, barcode, brand, size_label, price, current_stock }) => ({
            id,
            barcode,
            brand,
            size_label,
            price,
            current_stock,
          })
        ),
        session: {
          id: 901,
          shop_id: 1,
          cashier_user_id: 1,
          state: "active",
          baseline_business_date: "2026-09-22",
          server_last_invoice_number: 0,
          receipt_counter: 0,
          receipt_count: 0,
          gross_total: "0.00",
          expires_at: expires.toISOString(),
          max_expires_at: expires.toISOString(),
          extension_count: 0,
          sync_attempts: 0,
          sync_result: null,
          failure_reason: null,
          discard_reason: null,
          started_at: now.toISOString(),
          state_changed_at: now.toISOString(),
          synced_at: null,
          discarded_at: null,
          expired_at: null,
        },
      }),
    });
  });

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Work offline" }).click();
  await expect(page.getByRole("region", { name: "Offline session" })).toBeVisible();

  await enterBarcode(page, firstProduct.barcode);
  await enterBarcode(page, secondProduct.barcode);
  await enterBarcode(page, firstProduct.barcode);

  const cart = page.getByTestId("checkout-cart-lines");
  await expectLineOrder(cart, [firstProduct.brand, secondProduct.brand]);
  await expect(cart.locator(":scope > li").first().getByLabel("Quantity", { exact: true })).toHaveValue("2");
});

test("stock inward promotes scans and search picks, prepends quick-adds, and keeps review order", async ({
  page,
}) => {
  const catalog = [firstProduct, secondProduct];
  await setupMockedSession(page, "receiver_user");
  await mockCatalog(page, catalog);
  await page.route("**/products/lookup?*", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Not found" }) });
  });
  await page.route("**/products/quick-add", async (route) => {
    const payload = route.request().postDataJSON() as {
      barcode: string;
      brand: string;
      size_label: string;
    };
    const product: MockProduct = {
      id: 103,
      barcode: payload.barcode,
      brand: payload.brand,
      size_label: payload.size_label,
      price: null,
      is_active: true,
      status: "pending",
      current_stock: 0,
    };
    catalog.push(product);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(product) });
  });

  await page.goto("/receiving");
  await enterBarcode(page, firstProduct.barcode);

  const search = page.getByRole("combobox", {
    name: "Quick-search products by name or barcode",
  });
  await search.fill(secondProduct.brand);
  await page.getByRole("option").filter({ hasText: secondProduct.brand }).click();

  const lines = page.getByTestId("receiving-lines");
  await expectLineOrder(lines, [secondProduct.brand, firstProduct.brand]);

  await page.getByLabel("Reference (optional)").focus();
  await page.keyboard.type(firstProduct.barcode, { delay: 1 });
  await page.keyboard.press("Enter");
  await expectLineOrder(lines, [firstProduct.brand, secondProduct.brand]);
  await expect(lines.locator(":scope > li").first().getByLabel("Quantity", { exact: true })).toHaveValue("2");

  await enterBarcode(page, "LIFO-QUICK-003");
  const quickAdd = page.getByRole("dialog", { name: "Register new catalog item" });
  await quickAdd.getByPlaceholder("e.g. Royal Stag").fill("Charlie Quick Add");
  await quickAdd.getByPlaceholder("e.g. 750ml").fill("330ml");
  await quickAdd.getByRole("button", { name: "Add product" }).click();
  await expect(quickAdd).not.toBeVisible();
  await expectLineOrder(lines, ["Charlie Quick Add", firstProduct.brand, secondProduct.brand]);

  await page.getByRole("button", { name: "Review & Submit" }).click();
  const reviewRows = page
    .getByRole("dialog", { name: "Review purchase details" })
    .getByTestId("purchase-review-line-items")
    .locator("tbody tr");
  await expect(reviewRows.nth(0)).toContainText("Charlie Quick Add");
  await expect(reviewRows.nth(1)).toContainText(firstProduct.brand);
  await expect(reviewRows.nth(2)).toContainText(secondProduct.brand);
});
