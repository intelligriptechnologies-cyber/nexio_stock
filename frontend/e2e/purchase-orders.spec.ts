import { expect, test } from "@playwright/test";

const line = {
  id: 101,
  source_item_name: "Test Whisky(750)",
  size_ml: 750,
  product_id: 1,
  product_barcode: "8900000000750",
  product_brand: "Test Whisky",
  product_size_label: "750ml",
  cases: 1,
  loose_bottles: 0,
  pack_size_snapshot: 8,
  ordered_bottles: 8,
  case_rate: "800.00",
  mger: "500.00",
  amount: "800.00",
  sequence: 1,
  ocr_confidence: "0.9900",
  field_confidence: {},
  match_candidates: [{ product_id: 1, brand: "Test Whisky", size_label: "750ml", score: 1 }],
  delivered_bottles: 0,
  accepted_bottles: 0,
  broken_bottles: 0,
  remaining_bottles: 8,
  excess_bottles: 0,
};

const draft = {
  id: 17,
  shop_id: 1,
  osbcl_token: "OD-KHO(T)/9/2026-2027",
  order_date: "2026-09-19",
  order_type: "Liquor",
  retailer_name: "Test Retailer",
  retailer_code: "2534",
  vehicle_number: "OD02AB1234",
  total_cases: 1,
  total_loose_bottles: 0,
  mger_total: "500.00",
  order_total: "800.00",
  source_filename: "order.pdf",
  source_sha256: "a".repeat(64),
  page_count: 1,
  extraction_status: "ready",
  extraction_confidence: "0.9900",
  review_flags: [],
  status: "draft",
  created_by_user_id: 1,
  confirmed_by_user_id: null,
  cancelled_by_user_id: null,
  confirmed_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  created_at: "2026-09-23T12:00:00Z",
  updated_at: "2026-09-23T12:00:00Z",
  lines: [line],
};

test("imports, filters, finalizes, and dismisses an OSBCL PO dialog", async ({ page }) => {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  // Keep the encoded payload length divisible by four because the app's
  // deliberately tiny JWT decoder expects browser-atob-compatible padding.
  const claims = Buffer.from(JSON.stringify({ sub: "1", shop_id: 1, role: "owner", exp: Math.floor(Date.now() / 1000) + 3600, pad: "xx" })).toString("base64url");
  const token = `${header}.${claims}.signature`;

  let imported = false;
  let finalized = false;
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/purchase-orders/import") {
      imported = true;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(draft) });
    } else if (path === "/purchase-orders/17/finalize") {
      finalized = true;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ purchase_order: { ...draft, status: "fulfilled" }, stock_inward_id: 71, lot_id: 81 }) });
    } else if (path === "/purchase-orders/17" && route.request().method() === "PUT") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(draft) });
    } else if (path === "/purchase-orders") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ purchase_orders: imported ? [{ ...draft, status: finalized ? "fulfilled" : "draft" }] : [] }) });
    } else if (path === "/products" || path === "/products/catalog") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify([{ id: 1, barcode: line.product_barcode, brand: line.product_brand, size_label: line.product_size_label, price: "100.00", is_active: true, status: "active", current_stock: 0 }]) });
    } else if (path === "/shops/me") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: 1, name: "Shop One", code: "shop1", receiving_vendor_link_enabled: false }) });
    } else if (path === "/settings/me") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ app_display_name: "Nexio Stock", action_color: "#22c55e", active_tab_color: "#5a5148", sidebar_menu_inactive_text_color: "#535353cf", sidebar_menu_active_text_color: "#ffffff" }) });
    } else if (path === "/products/pending/count") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 0 }) });
    } else {
      await route.fulfill({ contentType: "application/json", body: "{}" });
    }
  });

  await page.goto("/login");
  await page.evaluate(({ storedToken }) => {
    sessionStorage.setItem("barstock.token", storedToken);
    sessionStorage.setItem("barstock.user", JSON.stringify({ id: 1, shopId: 1, role: "owner", username: "owner1", fullName: "Owner One", phone: "" }));
  }, { storedToken: token });
  await page.goto("/purchase-orders");
  await expect(page.getByRole("heading", { name: "OSBCL Purchase Orders" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "order.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 mocked") });
  await expect(page.getByRole("heading", { name: "PO #17" })).toBeVisible();
  await page.getByRole("button", { name: "Close purchase order" }).click();
  await page.getByLabel("Search purchase orders").fill("not-a-purchase-order");
  await expect(page.getByText("No purchase orders match these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Filter by status").selectOption("fulfilled");
  await expect(page.getByText("No purchase orders match these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByLabel("Order date from").fill("2026-09-20");
  await expect(page.getByText("No purchase orders match these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: "Edit draft" }).click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
  await expect(page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).resolves.toBeTruthy();
  await expect(page.locator('[role="dialog"] article').evaluate((element) => element.scrollWidth <= element.clientWidth)).resolves.toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")).resolves.toBeTruthy();
  await expect(page.locator('[role="dialog"] article').evaluate((element) => element.scrollWidth <= element.clientWidth)).resolves.toBeTruthy();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Close purchase order" }).click();
  await expect(page.getByRole("button", { name: "Edit draft" })).toBeFocused();
  await page.getByRole("button", { name: "Edit draft" }).press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Edit draft" })).toBeFocused();
  await page.getByRole("button", { name: "Edit draft" }).click();
  await page.mouse.click(1, 1);
  await expect(page.getByRole("button", { name: "Edit draft" })).toBeFocused();
  await page.getByRole("button", { name: "Edit draft" }).click();
  await page.getByRole("button", { name: "Finalize & create stock" }).click();
  await expect(page.getByRole("button", { name: "View" })).toBeVisible();
  await expect(page.getByText("fulfilled")).toBeVisible();
});

test("saves product selections before finalizing a draft", async ({ page }) => {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ sub: "1", shop_id: 1, role: "owner", exp: Math.floor(Date.now() / 1000) + 3600, pad: "xx" })).toString("base64url");
  const token = `${header}.${claims}.signature`;
  const serverDraft = {
    ...draft,
    lines: [{ ...line, product_id: null, product_barcode: null, product_brand: null, product_size_label: null }],
  };

  let imported = false;
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/purchase-orders/import") {
      imported = true;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(serverDraft) });
    } else if (path === "/purchase-orders/17" && route.request().method() === "PUT") {
      const payload = route.request().postDataJSON() as typeof serverDraft;
      serverDraft.lines[0].product_id = payload.lines[0].product_id;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(serverDraft) });
    } else if (path === "/purchase-orders/17/finalize") {
      if (serverDraft.lines[0].product_id === null) {
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ detail: { code: "incomplete", message: "Lines [1] need an active product and case-pack rule" } }) });
      } else {
        serverDraft.status = "fulfilled";
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ purchase_order: serverDraft, stock_inward_id: 71, lot_id: 81 }) });
      }
    } else if (path === "/purchase-orders") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ purchase_orders: imported ? [serverDraft] : [] }) });
    } else if (path === "/products" || path === "/products/catalog") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify([
        { id: 1, barcode: line.product_barcode, brand: line.product_brand, size_label: line.product_size_label, price: "100.00", is_active: true, status: "active", current_stock: 0 },
        { id: 2, barcode: "8900000000180", brand: "Alternate Whisky", size_label: "180ml", price: "40.00", is_active: true, status: "active", current_stock: 0 },
      ]) });
    } else if (path === "/shops/me") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: 1, name: "Shop One", code: "shop1", receiving_vendor_link_enabled: false }) });
    } else if (path === "/settings/me") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ app_display_name: "Nexio Stock", action_color: "#22c55e", active_tab_color: "#5a5148", sidebar_menu_inactive_text_color: "#535353cf", sidebar_menu_active_text_color: "#ffffff" }) });
    } else if (path === "/products/pending/count") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ count: 0 }) });
    } else {
      await route.fulfill({ contentType: "application/json", body: "{}" });
    }
  });

  await page.goto("/login");
  await page.evaluate(({ storedToken }) => {
    sessionStorage.setItem("barstock.token", storedToken);
    sessionStorage.setItem("barstock.user", JSON.stringify({ id: 1, shopId: 1, role: "owner", username: "owner1", fullName: "Owner One", phone: "" }));
  }, { storedToken: token });
  await page.goto("/purchase-orders");
  await page.locator('input[type="file"]').setInputFiles({ name: "order.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7 mocked") });
  await page.getByLabel("Product match for Test Whisky(750)").fill("Alternate Whisky · 180ml · 8900000000180");
  await page.getByRole("button", { name: "Finalize & create stock" }).click();

  await expect(page.getByRole("button", { name: "View" })).toBeVisible();
  expect(serverDraft.lines[0].product_id).toBe(2);
});
