import { test, expect, type Page, type Route } from "@playwright/test";
import {
  loginAsOwner as _loginAsOwner,
} from "./helpers/login";

const _login = { loginAsOwner: _loginAsOwner };

async function loginAsOwner(page: Page) {
  return _login.loginAsOwner(page);
}

function makeVoidInvoice(id = 101) {
  return {
    id,
    shop_id: 1,
    cashier_user_id: 7,
    cashier_name: "Cashier One",
    invoice_number: 5001,
    status: "pending_void",
    total_amount: "125.00",
    note: null,
    finalized_at: "2026-07-15T09:30:00.000Z",
    business_date: "2026-07-15",
    eod_signed_off: true,
    lines: [],
    payments: [],
  };
}

function makeInwardLot(id = 202) {
  return {
    id,
    shop_id: 1,
    vendor_id: 9,
    received_by_user_id: 11,
    purchase_date: "2026-07-14",
    vendor_invoice_number: "VIN-9",
    invoice_value: "450.00",
    reference: "REF-22",
    notes: null,
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
    received_at: "2026-07-15T08:10:00.000Z",
    created_at: "2026-07-15T08:10:00.000Z",
    updated_at: "2026-07-15T08:10:00.000Z",
    vendor: {
      id: 9,
      shop_id: 1,
      name: "Acme Spirits",
      gstin: null,
      address: null,
      email: null,
      phone: null,
      is_active: true,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    },
    lines: [
      {
        id: 1,
        product_id: 3,
        quantity: 4,
        good_condition_quantity: 4,
        breakage_quantity: 0,
        product_brand: "Royal Oak",
        product_size_label: "750ml",
      },
    ],
  };
}

function routeApprovals(page: Page) {
  let voidInvoices = [makeVoidInvoice()];
  let inwardLots = [makeInwardLot()];

  const fulfillJson = async (route: Route, payload: unknown) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  };

  void page.route("**/dashboard/void-queue*", async (route) => {
    await fulfillJson(route, { invoices: voidInvoices });
  });

  void page.route(/\/lots\?.*status=pending.*/, async (route) => {
    await fulfillJson(route, { lots: inwardLots });
  });

  void page.route("**/invoices/101/void/approve", async (route) => {
    voidInvoices = [];
    await fulfillJson(route, {
      ...makeVoidInvoice(),
      status: "voided",
    });
  });

  void page.route("**/lots/202/reject", async (route) => {
    inwardLots = [];
    await fulfillJson(route, {
      ...makeInwardLot(),
      status: "rejected",
    });
  });

  return {
    voidInvoices: () => voidInvoices,
    inwardLots: () => inwardLots,
  };
}

test.describe("approvals", () => {
  test("owner sees both queues and can act on the right type", async ({ page }) => {
    const queues = routeApprovals(page);
    await loginAsOwner(page);

    await expect(page.getByRole("link", { name: /Approvals \(2\)/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Approvals \(2\)/ }).getByText("NEW")).toBeVisible();

    await page.goto("/approvals");
    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Void Approvals (1)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Inward Approvals (1)" })).toBeVisible();

    const voidRow = page.locator("li").filter({ hasText: "Invoice #5001" }).first();
    await expect(voidRow).toBeVisible();
    await voidRow.getByRole("button", { name: "Approve" }).click();
    await expect(voidRow).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Approvals \(1\)/ })).toBeVisible();

    await page.getByRole("button", { name: "Inward Approvals (1)" }).click();
    const inwardRow = page.locator("li").filter({ hasText: "Inward #202" }).first();
    await expect(inwardRow).toBeVisible();
    await inwardRow.getByRole("button", { name: "Reject" }).click();
    await expect(inwardRow).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Approvals \(0\)/ })).toBeVisible();

    expect(queues.voidInvoices()).toHaveLength(0);
    expect(queues.inwardLots()).toHaveLength(0);
  });

  test("legacy routes redirect to the unified approvals screen", async ({ page }) => {
    routeApprovals(page);
    await loginAsOwner(page);

    await page.goto("/admin/voids");
    await expect(page).toHaveURL(/\/approvals\?tab=voids$/);
    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();

    await page.goto("/admin/stock-inward-queue");
    await expect(page).toHaveURL(/\/approvals\?tab=inward$/);
    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
  });

});
