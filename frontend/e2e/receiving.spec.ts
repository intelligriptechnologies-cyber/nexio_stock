import { test, expect, type Page } from "@playwright/test";
import { loginAsOwner, loginAsReceiver } from "./helpers/login";

// The receiving flow now needs an active vendor before the review modal
// can submit. This helper logs in as owner, creates a vendor, logs out,
// then logs back in as receiver so each spec starts with the right data.
async function prepareReceivingSession(page: Page) {
  await loginAsOwner(page);
  await page.goto("/admin/vendors");
  await expect(page.getByRole("heading", { name: "Vendors" })).toBeVisible({ timeout: 5000 });
  await page.getByLabel("Name").fill("E2E Vendor");
  await page.getByLabel("GSTIN").fill("21ABCDE1234F1Z5");
  await page.getByLabel("Address").fill("Test address");
  await page.getByLabel("Email").fill("vendor@example.com");
  await page.getByLabel("Phone").fill("+15555550004");
  await page.getByRole("button", { name: "Create vendor" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Vendor created." })).toBeVisible({
    timeout: 5000,
  });

  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await loginAsReceiver(page);
}

async function openPurchaseReview(page: Page) {
  await page.getByPlaceholder("Scan or enter barcode").fill("8901234567890");
  await page.getByRole("button", { name: "ADD" }).click();
  await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Review & Submit" }).click();
  const dialog = page.getByRole("dialog", { name: "Review purchase details" });
  await expect(dialog).toBeVisible({ timeout: 5000 });
  return dialog;
}

async function prepareMockedPurchaseReview(
  page: Page,
  options: {
    vendorLinkEnabled?: boolean;
    onVendorRequest?: () => void;
    onLotPayload?: (payload: unknown) => void;
  } = {}
) {
  const vendorLinkEnabled = options.vendorLinkEnabled ?? true;
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "1",
      shop_id: 1,
      role: "receiver_user",
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString("base64url");

  await page.addInitScript((token) => {
    sessionStorage.setItem("barstock.token", token);
    sessionStorage.setItem(
      "barstock.user",
      JSON.stringify({
        id: 1,
        shopId: 1,
        role: "receiver_user",
        username: "receiver1",
        fullName: "Receiver One",
        phone: "0000000001",
      })
    );
  }, `${header}.${payload}.signature`);

  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/products" || path === "/products/catalog") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            barcode: "8901234567890",
            brand: "Royal Stag",
            size_label: "750ml",
            price: "100.00",
            is_active: true,
            status: "active",
            current_stock: 12,
          },
        ]),
      });
      return;
    }
    if (path === "/vendors") {
      options.onVendorRequest?.();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            shop_id: 1,
            name: "E2E Vendor",
            gstin: null,
            address: null,
            email: null,
            phone: null,
            is_active: true,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ]),
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
          current_business_date: "2026-09-13",
          gstin: null,
          excise_duty_rate: null,
          low_stock_threshold_default: null,
          cashier_login_restriction_enabled: false,
          receiving_vendor_link_enabled: vendorLinkEnabled,
          allowed_login_cidrs: [],
        }),
      });
      return;
    }
    if (path === "/lots" && route.request().method() === "POST") {
      const payload = route.request().postDataJSON();
      options.onLotPayload?.(payload);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: 42,
          shop_id: 1,
          vendor_id: null,
          received_by_user_id: 1,
          purchase_date: "2026-09-13",
          vendor_invoice_number: "AUTO-RECEIPT",
          invoice_value: "0.00",
          merchandise_total: null,
          purchase_details_captured: false,
          reference: null,
          notes: payload.notes ?? null,
          status: "pending",
          approved_by_user_id: null,
          rejected_by_user_id: null,
          lot_id: null,
          created_by_name: "Receiver One",
          approved_by_name: null,
          rejected_by_name: null,
          approved_at: null,
          rejected_at: null,
          completed_at: null,
          received_at: "2026-09-13T12:00:00Z",
          created_at: "2026-09-13T12:00:00Z",
          updated_at: "2026-09-13T12:00:00Z",
          vendor: null,
          lines: [{
            id: 1,
            product_id: 1,
            quantity: 1,
            good_condition_quantity: 1,
            breakage_quantity: 0,
            unit_cost: null,
            line_total: null,
            product_brand: "Royal Stag",
            product_size_label: "750ml",
          }],
        }),
      });
      return;
    }
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
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });

  await page.goto("/receiving");
  await expect(page.getByRole("heading", { name: "Stock Inward" })).toBeVisible();
  if (vendorLinkEnabled) return openPurchaseReview(page);
  await page.getByPlaceholder("Scan or enter barcode").fill("8901234567890");
  await page.getByRole("button", { name: "ADD" }).click();
  await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Review & Submit" }).click();
  const dialog = page.getByRole("dialog", { name: "Review inward" });
  await expect(dialog).toBeVisible({ timeout: 5000 });
  return dialog;
}

test.describe("stock inward - new lot", () => {
  test("renders the receiving panel for a receiver", async ({ page }) => {
    await loginAsReceiver(page);
    await expect(page.getByRole("heading", { name: "Stock Inward" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review & Submit" })).toBeVisible();
    await expect(page.getByText("No items yet")).toBeVisible();
  });

  test("help opens in a new tab from stock inward", async ({ page }) => {
    await loginAsReceiver(page);
    const helpLink = page.getByRole("link", { name: "Help" });
    await expect(helpLink).toHaveAttribute("href", "/help/receiving");
    await expect(helpLink).toHaveAttribute("target", "_blank");
    await expect(helpLink).toHaveAttribute("rel", /noopener/);

    const helpPagePromise = page.waitForEvent("popup");
    await helpLink.click();
    const helpPage = await helpPagePromise;
    await expect(helpPage).toHaveURL(/\/help\/receiving$/);
    await expect(helpPage.getByRole("heading", { name: "Stock Inward Help" })).toBeVisible();
  });

  test("scanning a barcode adds a line with default quantity", async ({ page }) => {
    await loginAsReceiver(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("8901234567890");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("scan-success-overlay")).toHaveCount(0);
    await expect(page.getByLabel("Quantity")).toHaveValue("1");
    await expect(page.getByRole("button", { name: "Increase quantity" })).toBeVisible();
  });

  test("global scanner adds a line even when another field is focused", async ({ page }) => {
    await loginAsReceiver(page);
    await page.getByLabel("Reference (optional)").focus();
    await page.keyboard.type("8901234567890", { delay: 1 });
    await page.keyboard.press("Enter");
    const overlay = page.getByTestId("scan-success-overlay");
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await expect(overlay).toContainText("Royal Stag");
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel("Quantity")).toHaveValue("1");
    await expect(overlay).not.toBeVisible({ timeout: 2500 });
    await expect(page.getByLabel("Quantity")).toHaveValue("1");
  });

  test("scanned lines expose fast quantity controls", async ({ page }) => {
    await loginAsReceiver(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("8901234567890");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel("Quantity")).toHaveValue("1");
    await expect(page.getByRole("button", { name: "Increase quantity" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Decrease quantity" })).toBeVisible();
  });

  test("unknown barcode surfaces a clear error", async ({ page }) => {
    await loginAsReceiver(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("NOPE-NOT-IN-CATALOG");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByRole("alert")).toContainText(/not found/i);
  });
});

// --- Issue #22 - quick-add new product on the spot. -------------------

test.describe("stock inward - quick-add new product (issue #22)", () => {
  test("unknown barcode opens the quick-add modal", async ({ page }) => {
    await loginAsReceiver(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("QUICKADD-NEW-001");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(
      page.getByRole("dialog", { name: "Quick-add new product" })
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByRole("dialog", { name: "Quick-add new product" })
    ).toContainText("QUICKADD-NEW-001");
  });

  test("global scanner opens quick-add for a missing barcode", async ({ page }) => {
    await loginAsReceiver(page);
    const barcode = `QUICKADD-SCAN-${Date.now()}`;
    await page.keyboard.type(barcode, { delay: 1 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Quick-add new product" });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText(barcode);
    await expect(page.getByTestId("scan-success-overlay")).toHaveCount(0);
  });

  test("submitting the quick-add form adds the line and closes the modal", async ({
    page,
  }) => {
    await loginAsReceiver(page);
    const newBarcode = `QUICKADD-NEW-${Date.now()}`;
    await page.getByPlaceholder("Scan or enter barcode").fill(newBarcode);
    await page.getByRole("button", { name: "ADD" }).click();
    const dialog = page.getByRole("dialog", { name: "Quick-add new product" });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByPlaceholder("e.g. Royal Stag").fill("Quick Brand");
    await dialog.getByPlaceholder("e.g. 750ml").fill("750ml");
    await dialog.getByRole("button", { name: "ADD" }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Quick Brand")).toBeVisible();
    await expect(page.getByText("750ml")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /pending/i })).toBeVisible();
  });

  test("cancel button closes the quick-add modal without adding a line", async ({
    page,
  }) => {
    await loginAsReceiver(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("QUICKADD-CANCEL-001");
    await page.getByRole("button", { name: "ADD" }).click();
    const dialog = page.getByRole("dialog", { name: "Quick-add new product" });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("No items yet")).toBeVisible();
  });
});

// --- Issue #23 - quicksearch by name or barcode. --------------------------

test.describe("stock inward - quicksearch (issue #23)", () => {
  test("typing a brand substring shows matching products in a dropdown", async ({
    page,
  }) => {
    await loginAsReceiver(page);
    const search = page.getByRole("combobox", {
      name: "Quick-search products by name or barcode",
    });
    await search.fill("stag");
    const option = page.getByRole("option").filter({ hasText: "Royal Stag" });
    await expect(option).toBeVisible({ timeout: 5000 });
  });

  test("typing a partial barcode substring shows matching products", async ({
    page,
  }) => {
    await loginAsReceiver(page);
    const search = page.getByRole("combobox", {
      name: "Quick-search products by name or barcode",
    });
    await search.fill("8901234");
    const option = page.getByRole("option").filter({ hasText: "8901234567890" });
    await expect(option).toBeVisible({ timeout: 5000 });
  });

  test("tapping a quicksearch match adds it to the lines like a scan", async ({
    page,
  }) => {
    await loginAsReceiver(page);
    const search = page.getByRole("combobox", {
      name: "Quick-search products by name or barcode",
    });
    await search.fill("Royal Stag");
    const option = page.getByRole("option").filter({ hasText: "Royal Stag" });
    await expect(option).toBeVisible({ timeout: 5000 });
    await option.click();
    await expect(page.getByLabel("Quantity")).toHaveValue("1");
    await expect(page.getByText(/Added:/)).toBeVisible();
    await expect(page.getByTestId("scan-success-overlay")).toHaveCount(0);
    await expect(search).toHaveValue("");
  });

  test("typing something that matches nothing shows 'No matches'", async ({
    page,
  }) => {
    await loginAsReceiver(page);
    const search = page.getByRole("combobox", {
      name: "Quick-search products by name or barcode",
    });
    await search.fill("zzznomatchstringzzz");
    await expect(page.getByText("No matches.")).toBeVisible({ timeout: 5000 });
  });

  test("review modal collects vendor and condition counts before save", async ({
    page,
  }) => {
    await prepareReceivingSession(page);
    const dialog = await openPurchaseReview(page);
    await expect(
      dialog.getByText(/Submit stays blocked until the merchandise total matches/i)
    ).toBeVisible();
    await dialog.getByLabel("Vendor").selectOption({ label: "E2E Vendor" });
    await dialog.getByLabel("Vendor invoice number").fill("E2E-INV-1");
    await dialog.getByLabel("Invoice value").fill("100.00");
    await dialog.getByLabel("Unit cost").fill("100.00");
    await dialog.getByLabel("Decrease good quantity").click();
    await dialog.getByRole("button", { name: "Confirm save" }).click();
    await expect(dialog).toContainText("Add notes when any breakage exists.");
    await dialog.getByLabel("Notes (required when breakage exists)").fill("Bottle arrived broken");
    await dialog.getByRole("button", { name: "Confirm save" }).click();
    await expect(page.getByRole("dialog", { name: "Review purchase details" })).toHaveCount(0);
    await expect(page.getByText(/Lot #\d+ saved/)).toBeVisible({ timeout: 5000 });
  });

  test("disabled vendor linking uses the simplified review and reduced payload", async ({ page }) => {
    let vendorRequests = 0;
    let submittedPayload: Record<string, unknown> | null = null;
    const dialog = await prepareMockedPurchaseReview(page, {
      vendorLinkEnabled: false,
      onVendorRequest: () => { vendorRequests += 1; },
      onLotPayload: (payload) => { submittedPayload = payload as Record<string, unknown>; },
    });

    await expect(dialog.getByLabel("Vendor")).toHaveCount(0);
    await expect(dialog.getByLabel("Purchase date")).toHaveCount(0);
    await expect(dialog.getByLabel("Vendor invoice number")).toHaveCount(0);
    await expect(dialog.getByLabel("Invoice value")).toHaveCount(0);
    await expect(dialog.getByLabel("Unit cost")).toHaveCount(0);
    expect(vendorRequests).toBe(0);

    await dialog.getByLabel("Decrease good quantity").click();
    await dialog.getByRole("button", { name: "Confirm save" }).click();
    await expect(dialog).toContainText("Add notes when any breakage exists.");
    await dialog.getByLabel("Notes (required when breakage exists)").fill("One bottle broken");
    await dialog.getByRole("button", { name: "Confirm save" }).click();

    expect(submittedPayload).not.toBeNull();
    const savedPayload = (submittedPayload ?? {}) as Record<string, unknown>;
    expect(savedPayload).toMatchObject({
      notes: "One bottle broken",
      lines: [{
        barcode: "8901234567890",
        quantity: 1,
        good_condition_quantity: 0,
      }],
    });
    for (const field of ["vendor_id", "purchase_date", "vendor_invoice_number", "invoice_value"]) {
      expect(savedPayload).not.toHaveProperty(field);
    }
    expect((savedPayload.lines as Array<Record<string, unknown>>)[0]).not.toHaveProperty("unit_cost");
    await expect(page.getByText("Purchase details not captured")).toBeVisible();
    await expect(page.getByText("AUTO-RECEIPT")).toHaveCount(0);
    await expect(page.getByText("Rs 0.00")).toHaveCount(0);
  });

  test("purchase review fills a 1280 by 800 viewport and keeps every item column visible", async ({
    page,
  }) => {
    const dialog = await prepareMockedPurchaseReview(page);
    const dialogBox = await dialog.boundingBox();

    expect(dialogBox).not.toBeNull();
    expect(dialogBox?.x).toBe(0);
    expect(dialogBox?.y).toBe(0);
    expect(dialogBox?.width).toBe(1280);
    expect(dialogBox?.height).toBe(800);

    const lineItems = dialog.getByTestId("purchase-review-line-items");
    const horizontalMetrics = await lineItems.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(horizontalMetrics.scrollWidth).toBeLessThanOrEqual(horizontalMetrics.clientWidth);

    await expect(dialog.getByLabel("Unit cost")).toBeInViewport();
    await expect(dialog.getByRole("columnheader", { name: "Line total" })).toBeInViewport();

    for (const heading of ["Product", "Received", "Good", "Breakage", "Unit cost", "Line total"]) {
      await expect(dialog.getByRole("columnheader", { name: heading })).toHaveCSS(
        "white-space",
        "nowrap"
      );
    }

    const productCell = dialog.getByRole("cell").first();
    await expect(productCell).toHaveCSS("white-space", "nowrap");
    await expect(productCell.getByText("Royal Stag", { exact: true })).toHaveCSS(
      "white-space",
      "nowrap"
    );
    await expect(dialog.getByLabel("Good-condition quantity").locator("xpath=..")).toHaveCSS(
      "flex-wrap",
      "nowrap"
    );
    await expect(dialog.getByLabel("Unit cost").locator("xpath=..")).toHaveCSS(
      "white-space",
      "nowrap"
    );

    const header = dialog.getByTestId("purchase-review-header");
    const footer = dialog.getByTestId("purchase-review-footer");
    const content = dialog.getByTestId("purchase-review-content");
    const headerBefore = await header.boundingBox();
    const footerBefore = await footer.boundingBox();
    await content.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    expect(await header.boundingBox()).toEqual(headerBefore);
    expect(await footer.boundingBox()).toEqual(footerBefore);
  });

  test("narrow purchase review contains horizontal scrolling inside the item table", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 600, height: 700 });
    const dialog = await prepareMockedPurchaseReview(page);
    const dialogBox = await dialog.boundingBox();

    expect(dialogBox).not.toBeNull();
    expect(dialogBox?.x).toBe(0);
    expect(dialogBox?.y).toBe(0);
    expect(dialogBox?.width).toBe(600);
    expect(dialogBox?.height).toBe(700);

    const lineItems = dialog.getByTestId("purchase-review-line-items");
    const horizontalMetrics = await lineItems.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(horizontalMetrics.scrollWidth).toBeGreaterThan(horizontalMetrics.clientWidth);
    expect(
      await page.evaluate(() => {
        const browser = globalThis as typeof globalThis & {
          document: { documentElement: { scrollWidth: number } };
          innerWidth: number;
        };
        return browser.document.documentElement.scrollWidth <= browser.innerWidth;
      })
    ).toBe(true);
  });

  test("full-screen purchase review preserves focus trapping and every close action", async ({
    page,
  }) => {
    let dialog = await prepareMockedPurchaseReview(page);
    const closeButton = dialog.getByRole("button", { name: "Close purchase review" });
    const cancelButton = dialog.getByRole("button", { name: "Cancel" });

    await expect(closeButton).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(cancelButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeButton).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "Review & Submit" }).click();
    dialog = page.getByRole("dialog", { name: "Review purchase details" });
    await dialog.getByRole("button", { name: "Close purchase review" }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole("button", { name: "Review & Submit" }).click();
    dialog = page.getByRole("dialog", { name: "Review purchase details" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

});
