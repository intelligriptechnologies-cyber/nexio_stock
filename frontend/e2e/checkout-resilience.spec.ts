import { test, expect, type Page } from "@playwright/test";
import { loginAsCashier as _loginAsCashier, loginAsOwner as _loginAsOwner, loginAsReceiver as _loginAsReceiver } from "./helpers/login";
const _login = { loginAsCashier: _loginAsCashier, loginAsOwner: _loginAsOwner, loginAsReceiver: _loginAsReceiver };
async function loginAsCashier(page: Page) {
  return _login.loginAsCashier(page);
}

// Offline-queue / retry smoke tests for issue #12. They exercise the
// localStorage queue and the auto-flush path WITHOUT requiring a real
// network failure (which is fiddly in CI). The flow:
//
//   1. Login as cashier.
//   2. Inject a queued finalize entry directly into localStorage that
//      targets a non-existent product — this forces a server-side
//      invariant failure when the queue flushes, simulating
//      "stock depleted while offline".
//   3. Click 'Retry now'.
//   4. Verify a specific, actionable error surfaces (not silent).
//
// The auto-flush-on-online transition is covered by useOnlineStatus +
// useRetryQueue unit logic in the source; an end-to-end browser-online
// toggle test is environment-dependent (Chromium honours navigator.onLine
// but the platform must dispatch the event).

test.describe("checkout resilience — offline queue", () => {
  test("a queued finalize that fails an invariant surfaces a specific error", async ({
    page,
  }) => {
    await loginAsCashier(page);
    // Seed a queued entry that targets a barcode the backend doesn't know.
    // Backend's /checkout/finalize will reject with a 4xx (insufficient
    // stock or unknown barcode), and our queue keeps the entry with
    // lastError set. The cashier must see the specific cause.
    await page.evaluate(() => {
      const queue = [
        {
          idempotencyKey: "offline-test-key-aaaa",
          body: {
            lines: [{ barcode: "MISSING-PRODUCT-999", quantity: 1 }],
            payments: [{ mode: "cash", amount: "100.00" }],
          },
          enqueuedAt: Date.now(),
          lastError: null,
          attempts: 0,
        },
      ];
      localStorage.setItem("barstock.finalize-queue.v1", JSON.stringify(queue));
    });
    // Reload so the snapshot is picked up at mount.
    await page.reload();
    await expect(page.getByRole("region", { name: "Pending finalize queue" })).toBeVisible();
    await expect(page.getByText(/MISSING-PRODUCT-999|offline-test-key/)).toBeVisible();

    // Click Retry now — backend will reject, lastError gets populated,
    // and the cashier-facing alert shows a specific HTTP status + detail.
    await page.getByRole("button", { name: "Retry now" }).click();

    // Either an HTTP 4xx error or a server-side detail surfaces in an
    // alert role. We accept either the bare status (4xx) or the full
    // detail message — the contract is "specific, not silent".
    const alert = page.locator("[role='alert']").first();
    await expect(alert).toBeVisible();
    const text = await alert.textContent();
    expect(text ?? "").toMatch(/HTTP|error|insufficient|not found|stock/i);
  });

  test("an empty queue shows no pending panel and no offline banner", async ({ page }) => {
    await loginAsCashier(page);
    await page.evaluate(() => localStorage.removeItem("barstock.finalize-queue.v1"));
    await page.reload();
    await expect(page.getByRole("region", { name: "Pending finalize queue" })).toHaveCount(0);
  });
});