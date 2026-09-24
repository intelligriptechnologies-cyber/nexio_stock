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

test("imports, confirms, and opens receiving against an OSBCL PO", async ({ page }) => {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  // Keep the encoded payload length divisible by four because the app's
  // deliberately tiny JWT decoder expects browser-atob-compatible padding.
  const claims = Buffer.from(JSON.stringify({ sub: "1", shop_id: 1, role: "owner", exp: Math.floor(Date.now() / 1000) + 3600, pad: "xx" })).toString("base64url");
  const token = `${header}.${claims}.signature`;

  let imported = false;
  let confirmed = false;
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/purchase-orders/import") {
      imported = true;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(draft) });
    } else if (path === "/purchase-orders/17/confirm") {
      confirmed = true;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...draft, status: "open", confirmed_by_user_id: 1, confirmed_at: "2026-09-23T12:05:00Z" }) });
    } else if (path === "/purchase-orders/17") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...draft, status: "open" }) });
    } else if (path === "/purchase-orders") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ purchase_orders: imported ? [{ ...draft, status: confirmed ? "open" : "draft" }] : [] }) });
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
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("button", { name: "Receive" })).toBeVisible();
  await page.getByRole("button", { name: "Receive" }).click();
  await expect(page).toHaveURL(/purchase_order_id=17/);
  await expect(page.getByText("Receiving against purchase order #17")).toBeVisible();
  await expect(page.getByText("Test Whisky").first()).toBeVisible();
});
