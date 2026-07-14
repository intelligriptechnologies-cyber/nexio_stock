import { test, expect, type Page } from "@playwright/test";
import { loginAsCashier as _loginAsCashier, loginAsOwner as _loginAsOwner, loginAsReceiver as _loginAsReceiver } from "./helpers/login";
const _login = { loginAsCashier: _loginAsCashier, loginAsOwner: _loginAsOwner, loginAsReceiver: _loginAsReceiver };
async function loginAsOwner(page: Page) {
  return _login.loginAsOwner(page);
}
async function loginAsCashier(page: Page) {
  return _login.loginAsCashier(page);
}

test.describe("settings", () => {
  test("owner reaches invoice settings from the old shop config URL", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/shop");
    await expect(page).toHaveURL(/\/admin\/settings$/);
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Invoice Settings" }).click();
    await expect(page.getByText(/GSTIN/)).toBeVisible();
    await expect(page.getByText(/Excise duty rate/)).toBeVisible();
    await expect(page.getByText(/Default low-stock threshold/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  });

  test("owner can edit shop settings and own security profile", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/admin/settings");

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByLabel("Sidebar Brand Name")).toHaveValue("BarStock");
    await expect(page.getByRole("textbox", { name: "Active/Button Color value", exact: true })).toHaveValue("#22c55e");
    await expect(page.getByRole("textbox", { name: "Highlighted Tab Color value", exact: true })).toHaveValue("#5a5148");
    await expect(page.getByRole("textbox", { name: "Inactive Menu Text Color value", exact: true })).toHaveValue("#535353cf");
    await expect(page.getByRole("textbox", { name: "Active Menu Text Color value", exact: true })).toHaveValue("#ffffff");

    const actionColor = page.getByRole("textbox", { name: "Active/Button Color value", exact: true });
    await actionColor.fill("#2563eb");
    await expect(actionColor).toHaveValue("#2563eb");
    await page.getByRole("button", { name: "Reset" }).first().click();
    await expect(actionColor).toHaveValue("#22c55e");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("General settings saved.");

    await page.getByRole("button", { name: "Security" }).click();
    await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
    await expect(page.getByLabel("Username")).toHaveValue("owner1");
    await expect(page.getByLabel("Username")).toHaveAttribute("readonly", "");

    await page.getByLabel("Email").fill("owner@example.com");
    await page.getByLabel("Phone").fill("+15555559999");
    await page.getByLabel("Date of Birth").fill("1991-05-06");
    await page.getByLabel("PAN").fill("ABCDE1234F");
    await page.getByLabel("GSTIN").fill("21ABCDE1234F1Z5");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByRole("status")).toContainText("Security profile saved.");

    await page.getByLabel("Current password").fill("ownerpass");
    await page.getByLabel("New password").fill("new-owner-pass");
    await page.getByLabel("Confirm password").fill("different-pass");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("alert")).toContainText("New password and confirm password must match.");

    await page.getByLabel("Confirm password").fill("new-owner-pass");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("status")).toContainText("Password/PIN changed.");

    await page.getByLabel("Current password").fill("new-owner-pass");
    await page.getByLabel("New password").fill("ownerpass");
    await page.getByLabel("Confirm password").fill("ownerpass");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("status")).toContainText("Password/PIN changed.");
  });

  test("cashier cannot reach settings", async ({ page }) => {
    await loginAsCashier(page);
    await page.goto("/admin/shop");
    await expect(page).toHaveURL(/\/forbidden$/);
    await expect(page.getByRole("heading", { name: /403/ })).toBeVisible();
  });
});
