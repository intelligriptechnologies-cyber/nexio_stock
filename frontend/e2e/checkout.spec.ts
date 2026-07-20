import { test, expect } from "@playwright/test";
import { loginAsCashier, loginAsOwner, loginAsRole } from "./helpers/login";

// Smoke + a single happy-path finalize for the cashier checkout flow.
// Requires:
//   - seeded products (e.g. barcode 8901234567890 priced at 100)
//   - cashier login working (login.smoke.spec.ts prerequisite)
//   - backend running with the test schema
//
// One test per AC category; full e2e suite for this slice lives here.

test.describe("checkout flow", () => {
  test("renders cart + payment panels for a cashier", async ({ page }) => {
    await loginAsRole(page, "Owner", "ownerpass");
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Payment" })).toBeVisible();
    await expect(page.getByRole("button", { name: "FINISH & PAY" })).toBeVisible();
    // Cart starts empty
    await expect(page.getByText("No items in cart")).toBeVisible();
  });

// --- Issue #42 — show available stock per shop in cart / lot lines. ---

test.describe("checkout flow — per-line stock (issue #42)", () => {
  test("cart line stock updates to the backend validation result", async ({ page }) => {
    const barcode = "8901234567890";
    let productsFetchCount = 0;

    await page.route(/\/products(\?.*)?$/, async (route) => {
      productsFetchCount += 1;
      const stock = productsFetchCount === 1 ? 9 : 4;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            barcode,
            brand: "Royal Stag",
            size_label: "750ml",
            price: "100.00",
            is_active: true,
            status: "active",
            current_stock: stock,
          },
        ]),
      });
    });

    await page.route(/\/checkout\/validate$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          lines: [
            {
              barcode,
              requested_quantity: 1,
              available_quantity: 2,
              accepted_quantity: 1,
              adjusted: false,
            },
          ],
        }),
      });
    });

    await loginAsRole(page, "Owner", "ownerpass");
    await page.goto("/checkout");
    await page.getByPlaceholder("Scan or enter barcode").fill(barcode);
    await page.getByRole("button", { name: "ADD" }).click();

    const cartLine = page.locator("li").filter({ hasText: barcode }).first();
    await expect(cartLine).toContainText("In stock: 9");
    await expect(cartLine).toContainText("Last 2 remaining", { timeout: 5000 });
  });
});

// --- Issue #23 — quicksearch at checkout. -------------------------------

test.describe("checkout flow — quicksearch (issue #23)", () => {
  test("quicksearch dropdown matches brand substring and adds to cart", async ({
    page,
  }) => {
    await loginAsRole(page, "Owner", "ownerpass");
    await page.goto("/checkout");
    const search = page.getByRole("combobox", {
      name: "Quick-search products by name or barcode",
    });
    await search.fill("stag");
    const option = page.getByRole("option").filter({ hasText: "Royal Stag" });
    await expect(option).toBeVisible({ timeout: 5000 });
    await option.click();
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("scan-success-overlay")).toHaveCount(0);
    // Search cleared, cart line is present.
    await expect(search).toHaveValue("");
  });
});

test.describe("checkout flow — post-finalize catalog refresh", () => {
  test("a successful finalize refreshes the catalog before the next scan", async ({ page }) => {
    const barcode = "8901234567890";
    let productsFetchCount = 0;

    await page.route(/\/products(\?.*)?$/, async (route) => {
      productsFetchCount += 1;
      const stock = productsFetchCount === 1 ? 9 : 4;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            barcode,
            brand: "Royal Stag",
            size_label: "750ml",
            price: "100.00",
            is_active: true,
            status: "active",
            current_stock: stock,
          },
        ]),
      });
    });

    await page.route(/\/checkout\/validate$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          lines: [
            {
              barcode,
              requested_quantity: 1,
              available_quantity: 2,
              accepted_quantity: 1,
              adjusted: false,
            },
          ],
        }),
      });
    });

    await page.route(/\/checkout\/finalize$/, async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          invoice: {
            id: 501,
            shop_id: 1,
            cashier_user_id: 2,
            cashier_name: "Cashier One",
            invoice_number: 9001,
            status: "finalized",
            total_amount: "100.00",
            note: null,
            finalized_at: "2026-07-14T00:00:00.000Z",
            business_date: "2026-07-14",
            eod_signed_off: false,
            lines: [
              {
                id: 1,
                product_id: 1,
                quantity: 1,
                unit_price: "100.00",
                line_total: "100.00",
                product_brand: "Royal Stag",
                product_size_label: "750ml",
              },
            ],
            payments: [
              {
                id: 1,
                mode: "cash",
                amount: "100.00",
              },
            ],
          },
          is_replay: false,
        }),
      });
    });

    await loginAsRole(page, "Owner", "ownerpass");
    await page.goto("/checkout");
    await page.getByPlaceholder("Scan or enter barcode").fill(barcode);
    await page.getByRole("button", { name: "ADD" }).click();

    const cartLine = page.locator("li").filter({ hasText: barcode }).first();
    await expect(cartLine).toContainText("In stock: 9");
    await expect(cartLine).toContainText("Last 2 remaining", { timeout: 5000 });

    await page.getByRole("button", { name: "FINISH & PAY" }).click();
    await expect(page.getByRole("dialog")).toContainText("Invoice #9001");

    await page.getByRole("button", { name: "Close" }).click();
    await page.getByPlaceholder("Scan or enter barcode").fill(barcode);
    await page.getByRole("button", { name: "ADD" }).click();

    const refreshedLine = page.locator("li").filter({ hasText: barcode }).first();
    await expect(refreshedLine).toContainText("In stock: 4");
  });
});

  test("scanning a known barcode adds the product line", async ({ page }) => {
    await loginAsCashier(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("8901234567890");
    await page.getByRole("button", { name: "ADD" }).click();
    // Wait for the catalog lookup + state update
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("scan-success-overlay")).toHaveCount(0);
    // Cart line is now rendered with the product's brand
    await expect(page.getByText(/8901234567890/)).toBeVisible();
  });

  test("global scanner adds a known barcode from any focused field", async ({ page }) => {
    await loginAsCashier(page);
    await page.getByLabel("Note (optional)").focus();
    await page.keyboard.type("8901234567890", { delay: 1 });
    await page.keyboard.press("Enter");
    const overlay = page.getByTestId("scan-success-overlay");
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await expect(overlay).toContainText("Royal Stag");
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/8901234567890/)).toBeVisible();
    await expect(overlay).not.toBeVisible({ timeout: 2500 });
    await expect(page.getByText(/8901234567890/)).toBeVisible();
  });

  test("unknown barcode surfaces a clear error", async ({ page }) => {
    await loginAsCashier(page);
    await page.getByPlaceholder("Scan or enter barcode").fill("DOES-NOT-EXIST-999");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByRole("alert")).toContainText(/not found/i);
  });

  test("global scanner opens quick-add for an unknown barcode", async ({ page }) => {
    await loginAsCashier(page);
    const barcode = `CHECKOUT-SCAN-${Date.now()}`;
    await page.keyboard.type(barcode, { delay: 1 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Quick-add new product" });
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText(barcode);
    await expect(page.getByTestId("scan-success-overlay")).toHaveCount(0);
  });

  test("split payment across two modes is supported", async ({ page }) => {
    await loginAsCashier(page);
    // Add one product first.
    await page.getByPlaceholder("Scan or enter barcode").fill("8901234567890");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByText(/Added:/)).toBeVisible({ timeout: 5000 });
    // Click "+ Split" to add a second payment row.
    await page.getByRole("button", { name: "+ Split" }).click();
    const amountInputs = page.getByLabel("Payment amount");
    await expect(amountInputs).toHaveCount(2);
  });
});

test.describe("checkout flow â€” offline resume", () => {
  test("work offline keeps existing behavior and help opens in a new tab", async ({ page }) => {
    await loginAsCashier(page);
    const helpLink = page.getByRole("link", { name: "Help" });
    await expect(helpLink).toHaveAttribute("href", "/help/checkout");
    await expect(helpLink).toHaveAttribute("target", "_blank");
    await expect(helpLink).toHaveAttribute("rel", /noopener/);

    const helpPagePromise = page.waitForEvent("popup");
    await helpLink.click();
    const helpPage = await helpPagePromise;
    await expect(helpPage).toHaveURL(/\/help\/checkout$/);
    await expect(helpPage.getByRole("heading", { name: "Checkout Help" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Work offline" })).toBeVisible();
    await page.getByRole("button", { name: "Work offline" }).click();
    await expect(page.getByRole("region", { name: "Offline session" })).toBeVisible({
      timeout: 5000,
    });
  });

  test("resume online appears only during an active offline session", async ({ page }) => {
    await loginAsCashier(page);
    await expect(page.getByRole("button", { name: "Resume Online" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Work offline" })).toBeVisible();

    await page.getByRole("button", { name: "Work offline" }).click();
    await expect(page.getByRole("region", { name: "Offline session" })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole("button", { name: "Resume Online" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Work offline" })).toHaveCount(0);
  });

  test("resume online probes healthz before syncing and clears offline state on success", async ({
    page,
  }) => {
    await loginAsCashier(page);
    const calls: string[] = [];
    let capture = false;
    await page.route("**/healthz", async (route) => {
      if (capture) calls.push("healthz");
      await route.continue();
    });
    await page.route("**/offline-sessions/**/sync", async (route) => {
      if (capture) calls.push("sync");
      await route.continue();
    });

    await page.getByRole("button", { name: "Work offline" }).click();
    await expect(page.getByRole("region", { name: "Offline session" })).toBeVisible({
      timeout: 5000,
    });
    await page.getByPlaceholder("Scan or enter barcode").fill("8901234567890");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByText(/Saved temporary receipt/)).toBeVisible({ timeout: 5000 });

    capture = true;
    await page.getByRole("button", { name: "Resume Online" }).click();
    await expect(page.getByRole("button", { name: "Work offline" })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole("button", { name: "Resume Online" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Offline session" })).toHaveCount(0);
    expect(calls).toEqual(["healthz", "sync"]);
  });

  test("resume online keeps the offline session active when the health probe fails", async ({
    page,
  }) => {
    await loginAsCashier(page);
    await page.route("**/healthz", async (route) => {
      await route.fulfill({ status: 500, json: { detail: "backend unavailable" } });
    });

    await page.getByRole("button", { name: "Work offline" }).click();
    await expect(page.getByRole("region", { name: "Offline session" })).toBeVisible({
      timeout: 5000,
    });
    await page.getByRole("button", { name: "Resume Online" }).click();

    await expect(page.getByRole("alert")).toContainText(/backend unavailable|Could not resume online/i);
    await expect(page.getByRole("region", { name: "Offline session" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume Online" })).toBeVisible();
  });

  test("resume online keeps receipts and the offline session active when sync fails", async ({
    page,
  }) => {
    await loginAsCashier(page);
    await page.route("**/healthz", async (route) => {
      await route.continue();
    });
    await page.route("**/offline-sessions/**/sync", async (route) => {
      await route.fulfill({ status: 500, json: { detail: "sync failed" } });
    });

    await page.getByRole("button", { name: "Work offline" }).click();
    await expect(page.getByRole("region", { name: "Offline session" })).toBeVisible({
      timeout: 5000,
    });
    await page.getByPlaceholder("Scan or enter barcode").fill("8901234567890");
    await page.getByRole("button", { name: "ADD" }).click();
    await expect(page.getByText(/Saved temporary receipt/)).toBeVisible({ timeout: 5000 });

    await page.getByRole("button", { name: "Resume Online" }).click();
    await expect(page.getByRole("alert")).toContainText(/sync failed|Could not resume online/i);
    await expect(page.getByRole("region", { name: "Offline session" })).toBeVisible();
    await expect(page.getByText(/OFF-/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume Online" })).toBeVisible();
  });

  test("resume online discards an empty offline session for an owner", async ({ page }) => {
    await loginAsOwner(page);
    await page.getByRole("button", { name: "Work offline" }).click();
    await expect(page.getByRole("region", { name: "Offline session" })).toBeVisible({
      timeout: 5000,
    });
    await page.getByRole("button", { name: "Resume Online" }).click();
    await expect(page.getByRole("button", { name: "Work offline" })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole("button", { name: "Resume Online" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Offline session" })).toHaveCount(0);
  });
});
