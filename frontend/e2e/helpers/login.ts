import { expect, type Page } from "@playwright/test";

export type Role = "Cashier" | "Receiver" | "Owner";

const ROLE_TO_USERNAME: Record<Role, string> = {
  Cashier: "cashier1",
  Receiver: "receiver1",
  Owner: "owner1",
};

const ROLE_TO_HOME: Record<Role, RegExp> = {
  Cashier: /\/checkout$/,
  Receiver: /\/receiving$/,
  Owner: /\/dashboard$/,
};

const DEVICE_KEY = "test-terminal-01";

export async function loginAsRole(page: Page, role: Role, pin: string) {
  await page.addInitScript((deviceKey) => {
    localStorage.setItem("barstock.deviceKey", deviceKey);
  }, DEVICE_KEY);
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Terminal Access" })).toBeVisible({
    timeout: 5000,
  });
  const roleLabel = role === "Receiver" ? "Stock Keeper" : role === "Owner" ? "Shop Owner" : "Cashier";
  await page.getByRole("radio", { name: roleLabel }).check({ force: true });
  await page.getByLabel("Terminal ID / Username").fill(ROLE_TO_USERNAME[role]);
  await page.getByLabel("Security PIN").fill(pin);
  await page.getByRole("button", { name: "Open Terminal", exact: true }).click();
  await expect(page).toHaveURL(ROLE_TO_HOME[role]);
}

export async function loginAsReceiver(page: Page) {
  return loginAsRole(page, "Receiver", "recvpass");
}

export async function loginAsCashier(page: Page) {
  return loginAsRole(page, "Cashier", "cashpass");
}

export async function loginAsOwner(page: Page) {
  return loginAsRole(page, "Owner", "ownerpass");
}
