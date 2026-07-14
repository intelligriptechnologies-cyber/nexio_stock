import { expect, type Page } from "@playwright/test";

export type Role = "Cashier" | "Receiver" | "Owner";

const ROLE_TO_API_ROLE: Record<Role, string> = {
  Cashier: "cashier_user",
  Receiver: "receiver_user",
  Owner: "owner",
};

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
  await expect(page.getByRole("heading", { name: "Shop sign in" })).toBeVisible({
    timeout: 5000,
  });
  await page.getByLabel("Role").selectOption(ROLE_TO_API_ROLE[role]);
  await page.getByLabel("Username").fill(ROLE_TO_USERNAME[role]);
  await page.getByLabel(/PIN \/ Password|Password \/ PIN/).fill(pin);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
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
