import { test, expect, type Page } from "@playwright/test";
import {
  loginAsCashier as _loginAsCashier,
  loginAsOwner as _loginAsOwner,
} from "./helpers/login";

const API_BASE = process.env.VITE_API_BASE ?? "http://127.0.0.1:8000";
const _login = { loginAsCashier: _loginAsCashier, loginAsOwner: _loginAsOwner };

async function loginAsOwner(page: Page) {
  return _login.loginAsOwner(page);
}

async function loginAsCashier(page: Page) {
  return _login.loginAsCashier(page);
}

async function ownerToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => sessionStorage.getItem("barstock.token"));
  if (!token) throw new Error("owner token missing after login");
  return token;
}

async function createPendingProduct(page: Page, barcode: string) {
  const token = await ownerToken(page);
  const response = await page.request.post(`${API_BASE}/products/quick-add`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": `e2e-pending-${barcode}`,
      "X-Quick-Add-Origin": "receiving",
    },
    data: { barcode, brand: "Pending E2E", size_label: "750ml" },
  });
  expect(response.ok()).toBeTruthy();
}

async function scan(page: Page, barcode: string) {
  await page.getByLabel("Scan or enter barcode").fill(barcode);
  await page.getByLabel("Scan or enter barcode").press("Enter");
}

async function createProductFromScan(page: Page, barcode: string) {
  await scan(page, barcode);
  await expect(page.getByRole("heading", { name: "New product" })).toBeVisible();
  await expect(page.getByLabel("Barcode", { exact: true })).toHaveValue(barcode);
  await page.getByLabel("Brand").fill("E2E Brand");
  await page.getByLabel("Size label").fill("750ml");
  await page.getByLabel("Price").fill("199.00");
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByRole("heading", { name: "Edit product" })).toBeVisible();
}

test.describe("catalog - owner", () => {
  test("renders merged catalog workspace and can search", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/products");
    await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Catalog" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bulk import" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New product" })).toHaveCount(0);
    await page.getByPlaceholder("Search by brand").fill("XYZ-NO-MATCH");
    await expect(page.getByText(/No products match|Loading/)).toBeVisible();
  });

  test("fresh scanned barcode opens create form with barcode prefilled", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/products");
    const barcode = `e2e-fresh-${Date.now()}`;
    await scan(page, barcode);
    await expect(page.getByRole("heading", { name: "New product" })).toBeVisible();
    await expect(page.getByLabel("Barcode", { exact: true })).toHaveValue(barcode);
  });

  test("existing scanned barcode opens edit panel with fields loaded", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/products");
    const barcode = `e2e-existing-${Date.now()}`;
    await createProductFromScan(page, barcode);
    await scan(page, barcode);
    await expect(page.getByRole("heading", { name: "Edit product" })).toBeVisible();
    await expect(page.getByLabel("Brand")).toHaveValue("E2E Brand");
    await expect(page.getByLabel("Size label")).toHaveValue("750ml");
    await expect(page.getByLabel("Price")).toHaveValue("199.00");
  });

  test("pending scanned barcode can be priced and activated", async ({ page }) => {
    await loginAsOwner(page);
    const barcode = `e2e-pending-${Date.now()}`;
    await createPendingProduct(page, barcode);
    await page.goto("/admin/products");
    await scan(page, barcode);
    await expect(page.getByRole("heading", { name: "Pending product" })).toBeVisible();
    await expect(page.getByLabel("Price")).toHaveValue("");
    await page.getByLabel("Price").fill("225.00");
    await page.getByRole("button", { name: "Save and activate" }).click();
    await expect(page.getByRole("heading", { name: "Edit product" })).toBeVisible();
    await expect(page.getByText("active")).toBeVisible();
  });

  test("bulk import remains reachable", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/products");
    await page.getByRole("button", { name: "Bulk import" }).click();
    await expect(page.getByRole("heading", { name: "Bulk CSV import" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload CSV" })).toBeVisible();
  });
});

test.describe("catalog - non-owner blocked", () => {
  test("cashier is redirected to /forbidden from /admin/products", async ({ page }) => {
    await loginAsCashier(page);
    await page.goto("/admin/products");
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  });
});
