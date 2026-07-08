// Shared e2e helpers for the picker-based login flow (issue #24).
//
// The pre-#24 flow was: type phone digits → NEXT → type PIN → LOGIN.
// The post-#24 flow is: pick a name from the staff-picker tap-list →
// type PIN → LOGIN. These helpers wrap the new flow so each spec only
// has to import + call `loginAsRole(page, "Cashier", "1111")`.

import { expect, type Page } from "@playwright/test";

export type Role = "Cashier" | "Receiver" | "Owner";

const ROLE_TO_STAFF_ROLE: Record<Role, string> = {
  Cashier: "cashier_user",
  Receiver: "receiver_user",
  Owner: "owner",
};

const ROLE_TO_HOME: Record<Role, RegExp> = {
  Cashier: /\/checkout$/,
  Receiver: /\/receiving$/,
  Owner: /\/dashboard$/,
};

export async function loginAsRole(page: Page, role: Role, pin: string) {
  await page.goto("/login");
  await expect(page.getByText("Tap your name to sign in")).toBeVisible({
    timeout: 5000,
  });
  const row = page.locator(
    `[data-testid="staff-row"][data-staff-role="${ROLE_TO_STAFF_ROLE[role]}"]`
  );
  await expect(row).toBeVisible({ timeout: 5000 });
  await row.click();
  await expect(page.getByText("Enter your PIN")).toBeVisible();
  for (const d of pin) {
    await page.getByRole("button", { name: `Digit ${d}` }).click();
  }
  await page.getByRole("button", { name: "LOGIN" }).click();
  await expect(page).toHaveURL(ROLE_TO_HOME[role]);
}

// Convenience: each spec file's existing inline `loginAsReceiver`,
// `loginAsCashier` helpers can keep their name by delegating here.
// Pin defaults to the existing test seed ("1111" cashier, "2222" receiver).
export async function loginAsReceiver(page: Page) {
  await loginAsRole(page, "Receiver", "2222");
}

export async function loginAsCashier(page: Page) {
  await loginAsRole(page, "Cashier", "1111");
}

export async function loginAsOwner(page: Page) {
  await loginAsRole(page, "Owner", "3333");
}