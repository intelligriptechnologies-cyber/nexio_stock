import { test, expect, type Page } from "@playwright/test";
import { loginAsCashier as _loginAsCashier } from "./helpers/login";

async function loginAsCashier(page: Page) {
  return _loginAsCashier(page);
}

async function loginAsSuperadmin(page: Page) {
  await page.goto("/login/superadmin");
  await page.getByLabel("Username").fill("sa");
  await page.getByLabel("Password").fill("sapass");
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

function invoiceRowMatcher(invoiceNumber: number) {
  return new RegExp(`#${invoiceNumber}\\b`);
}

const currentInvoices = [
  {
    id: 101,
    shop_id: 1,
    cashier_user_id: 7,
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

async function mockInvoiceEndpoints(page: Page) {
  await page.route(/\/shops$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ id: 1, name: "Main Shop", code: "MSH" }]),
    });
  });

  await page.route(/\/dashboard\/eod-totals(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        business_date: "2026-07-13",
        signed_off: false,
        invoice_count: currentInvoices.length,
        revenue: "250.00",
        voided_count: 0,
        reversal_count: 0,
        payments_by_mode: [{ mode: "cash", amount: "250.00", count: 1 }],
      }),
    });
  });

  await page.route(/\/invoices(\?.*)?$/, async (route) => {
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
}

test.describe("invoice pdf actions", () => {
  test("download buttons are available for current and past invoices", async ({ page }) => {
    await mockInvoiceEndpoints(page);
    await loginAsCashier(page);

    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();

    const currentRow = page.locator("tr").filter({ hasText: invoiceRowMatcher(1001) });
    await expect(currentRow.getByRole("button", { name: "Download PDF" })).toBeVisible();

    const [currentDownload] = await Promise.all([
      page.waitForEvent("download"),
      currentRow.getByRole("button", { name: "Download PDF" }).click(),
    ]);
    expect(await currentDownload.suggestedFilename()).toBe("invoice-1001.pdf");

    await page.getByRole("button", { name: "Past Invoices" }).click();
    const pastRow = page.locator("tr").filter({ hasText: invoiceRowMatcher(9001) });
    await expect(pastRow.getByRole("button", { name: "Download PDF" })).toBeVisible();

    const [pastDownload] = await Promise.all([
      page.waitForEvent("download"),
      pastRow.getByRole("button", { name: "Download PDF" }).click(),
    ]);
    expect(await pastDownload.suggestedFilename()).toBe("invoice-9001.pdf");
  });

  test("superadmin can download after selecting a shop", async ({ page }) => {
    await mockInvoiceEndpoints(page);
    await loginAsSuperadmin(page);

    await page.goto("/invoices");
    await page.getByLabel("Shop").selectOption("1");

    const currentRow = page.locator("tr").filter({ hasText: invoiceRowMatcher(1001) });
    await expect(currentRow.getByRole("button", { name: "Download PDF" })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      currentRow.getByRole("button", { name: "Download PDF" }).click(),
    ]);
    expect(await download.suggestedFilename()).toBe("invoice-1001.pdf");
  });
});
