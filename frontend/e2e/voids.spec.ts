import { test, expect, type Page, type Route } from "@playwright/test";

async function seedOwner(page: Page) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payloadBody: { sub: string; shop_id: number; role: "owner"; exp: number; test_pad?: string } = {
    sub: "1", shop_id: 1, role: "owner", exp: Math.floor(Date.now() / 1000) + 3600,
  };
  let payload = Buffer.from(JSON.stringify(payloadBody)).toString("base64url");
  while (payload.length % 4 !== 0) {
    payloadBody.test_pad = `${payloadBody.test_pad ?? ""}x`;
    payload = Buffer.from(JSON.stringify(payloadBody)).toString("base64url");
  }
  await page.addInitScript((token) => {
    sessionStorage.setItem("barstock.token", token);
    sessionStorage.setItem("barstock.user", JSON.stringify({
      id: 1, shopId: 1, role: "owner", username: "owner", fullName: "Owner", phone: "0000000000",
    }));
  }, `${header}.${payload}.signature`);
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
    purchase_details_captured: true,
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

function routeApprovals(page: Page, totals?: { voids: number; inward: number }) {
  let voidInvoices = [makeVoidInvoice()];
  let inwardLots = [makeInwardLot()];
  const approvalUrls: string[] = [];

  const fulfillJson = async (route: Route, payload: unknown, total?: number) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: total == null ? undefined : {
        "Access-Control-Expose-Headers": "X-Total-Count",
        "X-Total-Count": String(total),
      },
      body: JSON.stringify(payload),
    });
  };

  void page.route("**/dashboard/void-queue*", async (route) => {
    approvalUrls.push(route.request().url());
    await fulfillJson(route, { invoices: voidInvoices }, totals?.voids);
  });

  void page.route("**/settings/me**", async (route) => {
    await fulfillJson(route, {
      id: 1, name: "Shop One", code: "shop1", app_display_name: "BarStock",
      action_color: "#22c55e", active_tab_color: "#5a5148",
      sidebar_menu_inactive_text_color: "#535353cf", sidebar_menu_active_text_color: "#ffffff",
    });
  });

  void page.route("**/products/pending/count**", async (route) => {
    await fulfillJson(route, { count: 0 });
  });

  void page.route(/\/lots\?.*status=pending.*/, async (route) => {
    approvalUrls.push(route.request().url());
    await fulfillJson(route, { lots: inwardLots }, totals?.inward);
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
    approvalUrls,
  };
}

test.describe("approvals", () => {
  test("both approval tabs expose synchronized top and bottom pagination", async ({ page }) => {
    const { approvalUrls } = routeApprovals(page, { voids: 60, inward: 90 });
    await seedOwner(page);
    await page.goto("/approvals");

    const voidTop = page.getByRole("navigation", { name: "voids approvals top pagination" });
    const voidBottom = page.getByRole("navigation", { name: "voids approvals bottom pagination" });
    await expect(voidTop).toContainText("of 60");
    await expect(voidBottom).toContainText("of 60");

    await page.getByLabel("voids approvals top items per page").selectOption("50");
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("1");
    await expect.poll(() => new URL(page.url()).searchParams.get("pageSize")).toBe("50");
    await expect.poll(() => approvalUrls.filter((raw) => {
      const params = new URL(raw).searchParams;
      return params.get("limit") === "50" && params.get("offset") === "0";
    }).length).toBeGreaterThanOrEqual(2);
    await expect(page.getByLabel("voids approvals bottom items per page")).toHaveValue("50");

    await page.getByRole("button", { name: "Inward Approvals (90)" }).click();
    const inwardTop = page.getByRole("navigation", { name: "inward approvals top pagination" });
    const inwardBottom = page.getByRole("navigation", { name: "inward approvals bottom pagination" });
    await expect(inwardTop).toContainText("of 90");
    await expect(inwardBottom).toContainText("of 90");
    await expect(page.getByLabel("inward approvals top items per page")).toHaveValue("50");
    await expect(page.getByLabel("inward approvals bottom items per page")).toHaveValue("50");

    await inwardTop.getByRole("button", { name: "Next page" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBe("inward");
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("2");
    await expect(inwardBottom.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  });

  test("owner sees both queues and can act on the right type", async ({ page }) => {
    const queues = routeApprovals(page);
    await seedOwner(page);
    await page.goto("/dashboard");

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
    await seedOwner(page);

    await page.goto("/admin/voids");
    await expect(page).toHaveURL(/\/approvals\?tab=voids$/);
    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();

    await page.goto("/admin/stock-inward-queue");
    await expect(page).toHaveURL(/\/approvals\?tab=inward$/);
    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
  });

});
