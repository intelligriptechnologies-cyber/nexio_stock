import { test, expect, type Page } from "@playwright/test";
import { loginAsCashier as _loginAsCashier } from "./helpers/login";

async function loginAsCashier(page: Page) {
  return _loginAsCashier(page);
}

async function loginAsSuperadmin(page: Page) {
  await page.goto("/login/superadmin");
  await page.getByLabel("Username").fill("root");
  await page.getByLabel("Password").fill("rootpass1");
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

function invoiceRowMatcher(invoiceNumber: number) {
  return new RegExp(`#${invoiceNumber}\\b`);
}

async function seedSuperadminSession(page: Page) {
  await page.addInitScript(() => {
    const storage = globalThis.sessionStorage;
    storage.setItem("barstock.token", "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxIiwic2hvcF9pZCI6bnVsbCwicm9sZSI6InN1cGVyYWRtaW4iLCJleHAiOjk5OTk5OTk5OTl9.signature");
    storage.setItem(
      "barstock.user",
      JSON.stringify({
        id: 1,
        shopId: null,
        role: "superadmin",
        username: "root",
        fullName: "Root",
        phone: "0000000000",
      })
    );
    storage.setItem("barstock.actingShopId", "1");
  });
}

async function seedOwnerSession(page: Page) {
  await page.addInitScript(() => {
    const storage = globalThis.sessionStorage;
    storage.setItem("barstock.token", "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIyIiwic2hvcF9pZCI6MSwicm9sZSI6Im93bmVyIiwiZXhwIjo5OTk5OTk5OTk5fQ.signature");
    storage.setItem(
      "barstock.user",
      JSON.stringify({
        id: 2,
        shopId: 1,
        role: "owner",
        username: "owner",
        fullName: "Owner One",
        phone: "1111111111",
      })
    );
  });
}

async function seedCashierSession(page: Page) {
  await page.addInitScript(() => {
    const storage = globalThis.sessionStorage;
    storage.setItem("barstock.token", "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIzIiwic2hvcF9pZCI6MSwicm9sZSI6ImNhc2hpZXJfdXNlciIsImV4cCI6OTk5OTk5OTk5OX0.signature");
    storage.setItem(
      "barstock.user",
      JSON.stringify({
        id: 3,
        shopId: 1,
        role: "cashier_user",
        username: "cashier",
        fullName: "Cashier One",
        phone: "2222222222",
      })
    );
  });
}

function todayLocalDateString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const currentInvoices = [
  {
    id: 101,
    shop_id: 1,
    cashier_user_id: 7,
    cashier_name: "Asha Patel",
    invoice_number: 1001,
    status: "finalized",
    total_amount: "250.00",
    note: null,
    finalized_at: "2026-07-13T09:15:00.000Z",
    business_date: "2026-07-13",
    eod_signed_off: false,
    lines: [
      {
        id: 1,
        product_id: 11,
        quantity: 2,
        unit_price: "100.00",
        line_total: "200.00",
        product_brand: "Royal Stag",
        product_size_label: "750ml",
      },
      {
        id: 2,
        product_id: 12,
        quantity: 1,
        unit_price: "50.00",
        line_total: "50.00",
        product_brand: "Signature",
        product_size_label: "375ml",
      },
    ],
    payments: [{ id: 1, mode: "cash", amount: "250.00" }],
  },
] as const;

const pastInvoices = [
  {
    id: 201,
    shop_id: 1,
    cashier_user_id: 7,
    cashier_name: "Asha Patel",
    invoice_number: 9001,
    status: "finalized",
    total_amount: "125.00",
    note: null,
    finalized_at: "2026-07-12T09:15:00.000Z",
    business_date: "2026-07-12",
    eod_signed_off: true,
    lines: [
      {
        id: 3,
        product_id: 21,
        quantity: 1,
        unit_price: "125.00",
        line_total: "125.00",
        product_brand: "Johnnie Walker",
        product_size_label: "750ml",
      },
    ],
    payments: [{ id: 2, mode: "upi", amount: "125.00" }],
  },
] as const;

const reconciledHistory = [
  {
    id: 301,
    business_date: "2026-07-12",
    signed_off_at: "2026-07-12T18:45:00.000Z",
    signed_off_by_user_id: 2,
    signed_off_by_name: "Owner One",
    invoices_signed_off: 3,
    revenue: "425.00",
    payments_by_mode: [
      { mode: "cash", amount: "225.00", count: 0 },
      { mode: "card", amount: "200.00", count: 0 },
    ],
    notes: "Cash and card tallied against the EOD worksheet.",
  },
] as const;

async function mockInvoiceEndpoints(page: Page) {
  let lastRequestedExportIds: string[] = [];
  await page.exposeFunction("getLastRequestedReconciliationExportIds", () => lastRequestedExportIds);
  const liveDate = todayLocalDateString();
  const backlogStart = "2026-07-13";

  await page.route(/\/shops$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: 1, name: "Main Shop", code: "MSH" }]),
    });
  });

  await page.route(/\/shops\/me(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 1,
        name: "Main Shop",
        code: "MSH",
        current_business_date: "1999-01-01",
        gstin: null,
        excise_duty_rate: null,
        low_stock_threshold_default: null,
        cashier_login_restriction_enabled: false,
        receiving_vendor_link_enabled: true,
        allowed_login_cidrs: [],
      }),
    });
  });

  await page.route(/\/dashboard\/eod-totals(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const businessDate = url.searchParams.get("business_date");
    const shopId = url.searchParams.get("shop_id");
    const scope = url.searchParams.get("scope");
    const isBacklog = scope === "open_backlog" && shopId === "1";
    const matched = businessDate === liveDate && shopId === "1";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        business_date: isBacklog ? liveDate : matched ? liveDate : "2026-07-13",
        signed_off: false,
        range_start_business_date: isBacklog ? backlogStart : matched ? liveDate : "2026-07-13",
        range_end_business_date: isBacklog ? liveDate : matched ? liveDate : "2026-07-13",
        invoice_count: isBacklog ? 2 : matched ? currentInvoices.length : 0,
        revenue: isBacklog ? "450.00" : matched ? "250.00" : "0.00",
        voided_count: 0,
        reversal_count: 0,
        payments_by_mode: isBacklog
          ? [
              { mode: "cash", amount: "250.00", count: 1 },
              { mode: "upi", amount: "200.00", count: 1 },
            ]
          : matched
            ? [{ mode: "cash", amount: "250.00", count: 1 }]
            : [],
      }),
    });
  });

  await page.route(/\/invoices\?.*$/, async (route) => {
    const url = new URL(route.request().url());
    const source = url.searchParams.get("source");
    const invoices = source === "past" ? pastInvoices : currentInvoices;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ invoices }),
    });
  });

  await page.route(/\/invoices\/\d+\/pdf$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF",
    });
  });

  await page.route(/\/dashboard\/eod-history(\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ signoffs: reconciledHistory }),
    });
  });

  await page.route(/\/dashboard\/eod-history\/export(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    lastRequestedExportIds = url.searchParams.getAll("signoff_id");
    await route.fulfill({
      status: 200,
      contentType: "text/csv",
      headers: {
        "Content-Disposition": 'attachment; filename="reconciliations-2026-07-17-1530.csv"',
      },
      body: [
        "reconciliation_id,invoice_id",
        `${reconciledHistory[0].id},501`,
      ].join("\n"),
    });
  });

  await page.route(/\/dashboard\/eod-history\/\d+(\?.*)?$/, async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(reconciledHistory[0]),
      });
      return;
    }
    if (method === "PATCH") {
      const payload = route.request().postDataJSON() as { notes?: string | null };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...reconciledHistory[0],
          notes: payload.notes ?? null,
        }),
      });
      return;
    }
    await route.fallback();
  });
}

test.describe("invoice pdf actions", () => {
  test("download buttons are available for current and past invoices", async ({ page }) => {
    await mockInvoiceEndpoints(page);
    await loginAsCashier(page);

    await page.setViewportSize({ width: 1280, height: 520 });
    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Invoices" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Status / EOD" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download invoices CSV" })).toBeEnabled();

    const currentRow = page.locator("tr").filter({ hasText: invoiceRowMatcher(1001) });
    await expect(currentRow).toContainText("Asha Patel");
    await expect(currentRow).not.toContainText("User #7");
    await expect(currentRow.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(currentRow.getByRole("button", { name: "Download" })).toBeVisible();
    await expect(currentRow.getByRole("button", { name: "Void" })).toBeVisible();

    const [currentDownload] = await Promise.all([
      page.waitForEvent("download"),
      currentRow.getByRole("button", { name: "Download" }).click(),
    ]);
    expect(await currentDownload.suggestedFilename()).toBe("invoice-1001.pdf");

    await page.getByRole("button", { name: "Past Invoices" }).click();
    const pastRow = page.locator("tr").filter({ hasText: invoiceRowMatcher(9001) });
    await expect(pastRow).toContainText("Asha Patel");
    await expect(pastRow.getByRole("button", { name: "Download" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download invoices CSV" })).toBeEnabled();

    const [pastDownload] = await Promise.all([
      page.waitForEvent("download"),
      pastRow.getByRole("button", { name: "Download" }).click(),
    ]);
    expect(await pastDownload.suggestedFilename()).toBe("invoice-9001.pdf");
  });

  test("invoice grid column toggles hide and restore items and payments without changing reconciled history", async ({
    page,
  }) => {
    await mockInvoiceEndpoints(page);
    await seedSuperadminSession(page);

    await page.goto("/invoices");

    const summary = page.locator("span.app-kicker").filter({ hasText: /^Showing 1 - 1 of 1$/ }).first();
    const invoiceButton = page.getByRole("button", { name: "#1001" });
    const itemCell = page.getByText("Royal Stag 750ml");
    const paymentCell = page.getByRole("cell", { name: /Cash/ });

    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    await expect(summary).toBeVisible();
    await expect(invoiceButton).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Items" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Payments" })).toBeVisible();
    await expect(itemCell).toBeVisible();
    await expect(paymentCell).toBeVisible();

    await page.getByRole("button", { name: "Hide Items" }).click();
    await expect(page.getByRole("button", { name: "Show Items" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Items" })).toHaveCount(0);
    await expect(itemCell).toHaveCount(0);
    await expect(summary).toHaveText("Showing 1 - 1 of 1");

    await page.getByRole("button", { name: "Show Items" }).click();
    await expect(page.getByRole("button", { name: "Hide Items" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Items" })).toBeVisible();
    await expect(itemCell).toBeVisible();

    await page.getByRole("button", { name: "Hide Payments" }).click();
    await expect(page.getByRole("button", { name: "Show Payments" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Payments" })).toHaveCount(0);
    await expect(paymentCell).toHaveCount(0);
    await expect(summary).toHaveText("Showing 1 - 1 of 1");

    await page.getByRole("button", { name: "Show Payments" }).click();
    await expect(page.getByRole("button", { name: "Hide Payments" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Payments" })).toBeVisible();
    await expect(paymentCell).toBeVisible();

    await page.getByRole("button", { name: "Hide Items" }).click();
    await page.getByRole("button", { name: "Hide Payments" }).click();
    await expect(page.getByRole("columnheader", { name: "Items" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Payments" })).toHaveCount(0);

    await page.getByRole("button", { name: "Reconciled History" }).click();
    await expect(page.getByRole("button", { name: "Show Items" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show Payments" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Payment Modes" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "REC-301" })).toBeVisible();
    await expect(summary).toHaveText("Showing 1 - 1 of 1");
  });

  test("superadmin can download after selecting a shop", async ({ page }) => {
    await mockInvoiceEndpoints(page);
    await loginAsSuperadmin(page);

    await page.goto("/invoices");
    await page.getByLabel("Shop").selectOption("1");

    const currentRow = page.locator("tr").filter({ hasText: invoiceRowMatcher(1001) });
    await expect(currentRow.getByRole("button", { name: "Download" })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      currentRow.getByRole("button", { name: "Download" }).click(),
    ]);
    expect(await download.suggestedFilename()).toBe("invoice-1001.pdf");
  });

test("reconcile summary uses the selected shop backlog range and shop_id", async ({ page }) => {
    await mockInvoiceEndpoints(page);
    await seedSuperadminSession(page);
    const liveDate = todayLocalDateString();
    await page.goto("/invoices");
    await page.getByRole("button", { name: "Reconcile Open Invoices" }).click();

    const dialog = page.getByRole("dialog", { name: "Main Shop" });
    await expect(dialog).toContainText(`Reconcile settlement for 2026-07-13 to ${liveDate}`);
    await expect(dialog).toContainText("Total open invoices");
    await expect(dialog).toContainText("2");
    await expect(dialog).toContainText("₹450.00");
    const shell = page.locator('[data-app-shell-scroll-container="true"]');
    await expect(shell).toBeVisible();
    await shell.evaluate((element) => {
      element.scrollTop = 0;
    });

    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(dialog.locator(":focus")).toHaveCount(1);

    const lockedScrollTop = await shell.evaluate((element) => element.scrollTop);
    await page.mouse.move(640, 260);
    await page.mouse.wheel(0, 900);
    await expect.poll(async () => shell.evaluate((element) => element.scrollTop)).toBe(
      lockedScrollTop
    );

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);

    await shell.evaluate((element) => {
      element.scrollTop = 0;
    });
    await shell.hover();
    await page.mouse.wheel(0, 900);
    await expect
      .poll(async () => shell.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
  });
  test("invoice edit modal locks background scroll and keeps focus trapped", async ({ page }) => {
    await mockInvoiceEndpoints(page);
    await seedSuperadminSession(page);
    await page.setViewportSize({ width: 1280, height: 520 });

    await page.goto("/invoices");
    const shell = page.locator('[data-app-shell-scroll-container="true"]');
    await expect(shell).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).first().click();

    const dialog = page.getByRole("dialog", { name: /Invoice #1001/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Invoice #1001" })).toBeVisible();

    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Tab");
    }

    await expect(dialog.locator(":focus")).toHaveCount(1);

    await shell.evaluate((element) => {
      element.scrollTop = 0;
    });
    const lockedScrollTop = await shell.evaluate((element) => element.scrollTop);
    await page.mouse.move(640, 260);
    await page.mouse.wheel(0, 900);
    await expect.poll(async () => shell.evaluate((element) => element.scrollTop)).toBe(
      lockedScrollTop
    );

    await dialog.getByRole("button", { name: "Close invoice dialog" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("owner sees Reconciled History and can update the note", async ({ page }) => {
    await mockInvoiceEndpoints(page);
    await seedOwnerSession(page);

    await page.goto("/invoices");
    await expect(page.getByRole("button", { name: "Reconciled History" })).toBeVisible();

    await page.getByRole("button", { name: "Reconciled History" }).click();
    await expect(page.getByRole("button", { name: "Download reconciled history CSV" })).toBeEnabled();
    await expect(page.getByRole("cell", { name: "Owner One" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "REC-301" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "₹425" })).toBeVisible();
    await expect(page.getByText("Cash ₹225, Card ₹200")).toBeVisible();
    await expect(page.getByText("Cash and card tallied against the EOD worksheet.")).toBeVisible();

    await page.getByRole("button", { name: "View" }).click();
    const dialog = page.getByRole("dialog", { name: /Reconciliation REC-301/ });
    await expect(dialog).toContainText("Invoices signed off");
    await expect(dialog).toContainText("Total received");
    await expect(dialog).toContainText("₹425");
    await expect(dialog).toContainText("Cash");
    await expect(dialog).toContainText("₹225");
    await expect(dialog).toContainText("Card");
    await expect(dialog).toContainText("₹200");
    await dialog.getByLabel("Reconciliation note").fill("Updated after till recount.");
    await dialog.getByRole("button", { name: "Save Note" }).click();

    await expect(page.getByRole("status")).toContainText("Reconciliation note updated.");

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download reconciled history CSV" }).click(),
    ]);
    expect(await download.suggestedFilename()).toBe("reconciliations-2026-07-17-1530.csv");
    await expect
      .poll(() => page.evaluate(() => (globalThis as typeof globalThis & { getLastRequestedReconciliationExportIds: () => Promise<string[]> }).getLastRequestedReconciliationExportIds()))
      .toEqual(["301"]);
  });

  test("cashier does not see Reconciled History", async ({ page }) => {
    await mockInvoiceEndpoints(page);
    await seedCashierSession(page);

    await page.goto("/invoices");
    await expect(page.getByRole("button", { name: "Open Invoices" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Past Invoices" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reconciled History" })).toHaveCount(0);
  });
});
