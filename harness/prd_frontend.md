# PRD: Barstock frontend (web SPA)

**Status: DRAFT — pending vertical-slice breakdown via /to-issues.**

## Problem Statement

Barstock's backend (all 8 backend slices, #1-#8) is fully built: auth/roles, product catalog + bulk import, lot receiving, checkout/invoicing, void/reversal, EOD reconciliation + owner dashboard, low-stock alerts, and a GST/excise invoice-line stub — all exposed as a versioned OpenAPI/Swagger REST API (R-11, D-31). There is no frontend at all. The friend's shop cannot actually run on Barstock today: staff would have to operate the system through raw HTTP calls or the Swagger UI, which fails R-23/D-38's core constraint that every screen must be usable by low-computer-literacy cashiers, receivers, and the owner. A visual design system and four high-fidelity screen mockups already exist (`docs/frontend_initial/`) but have never been wired to a real, running application.

## Solution

Build the Barstock web frontend as a React + TypeScript SPA in a new top-level `frontend/` directory, implementing the Barstock design system (`docs/frontend_initial/barstock_design.md`) and consuming the existing backend's OpenAPI spec directly (typed client generated from it, not hand-rolled fetch calls). The four already-mocked screens (PIN login, checkout/sales counter, stock receiving/new lot, owner dashboard/EOD) are built first, pixel-faithful to their mockups. The remaining backend-supported surfaces that never got a mockup — product catalog management + bulk CSV import, void-approval queue, staff/user management, invoice PDF preview, shop config (GSTIN/duty rate/default threshold), per-product low-stock threshold override — get new screens designed in the same design system and built alongside them, so the owner can run the whole shop from the UI without ever touching Swagger.

The frontend is a client-side app talking to the existing central API; it introduces no new backend endpoints. Two behaviors are frontend-only per the frozen backend PRD: a locally-cached product catalog for scan-time lookup with no per-scan network round trip (D-30), and a localStorage-backed write-queue that retries the checkout finalize call on reconnect after a connectivity drop (D-29, R-14).

## User Stories

1. As a cashier, I want to log in with a large-digit PIN pad, so that I can start a shift quickly without typing a password on a keyboard.
2. As a cashier, I want to scan a barcode and see the item appear instantly in a running cart list with brand, size, and price, so that I can bill fast without network lag per scan.
3. As a cashier, I want to see a large running total and the item list update after each scan, so that I always know exactly what's been rung up.
4. As a cashier, I want to remove a wrongly-scanned item from the cart before finalizing, so that I can fix a scan mistake without needing a void.
5. As a cashier, I want to enter a barcode manually when the scanner can't read it, so that I'm never blocked by a damaged label.
6. As a cashier, I want to select one payment mode (cash/UPI/card) by default with one tap, so that the common case stays fast.
7. As a cashier, I want the option to split a single sale's payment across more than one mode, so that I can handle a customer paying part cash, part UPI.
8. As a cashier, I want a single unmistakable "FINISH & PAY" action to finalize the sale, so that I never accidentally half-complete a transaction.
9. As a cashier, I want to see an on-screen invoice preview immediately after finalizing, so that I can confirm everything is correct before it's final.
10. As a cashier, I want to generate/download a PDF of the finalized invoice, so that I have a durable, shareable record for the customer.
11. As a cashier, I want the app to keep working if the internet drops mid-cart, and to queue the finalize call for automatic retry on reconnect, so that a brief outage doesn't stop me from serving customers.
12. As a cashier, I want a clear, specific error if a queued sale fails on retry (e.g., stock changed while offline), so that I know to resolve it manually instead of assuming it went through.
13. As a cashier, I want to request a void on a finalized invoice, so that I can correct a mistaken sale.
14. As a receiver, I want to log in with the same PIN pad flow, so that receiving uses one consistent login experience shop-wide.
15. As a receiver, I want to scan items into a new stock lot with large +/- controls for quantity, so that I can register incoming inventory quickly and without typos.
16. As a receiver, I want to manually enter a barcode when a label is unreadable, so that receiving isn't blocked by damaged packaging.
17. As a receiver, I want a single clear "SAVE STOCK" action to commit the lot, so that I know exactly when the receipt is recorded.
18. As an owner, I want to log in and see a dashboard with total revenue, invoice count, and cash/UPI/card split for the current business day, so that I have same-day visibility into sales.
19. As an owner, I want to see a chart of sales volume by hour, so that I can identify peak times.
20. As an owner, I want a visible low-stock section listing products at or below their effective threshold, so that I know what to reorder.
21. As an owner, I want a void-approval queue showing invoices pending my sign-off, so that I can approve or reject each one with the reason visible.
22. As an owner, I want a single "mark day end" action that closes out all counters' sales for the day together, so that EOD reconciliation matches how the business actually closes.
23. As an owner, I want to see a list of past EOD sign-offs, so that I can look back at any prior day's totals.
24. As an owner, I want to create a new product (brand, size, barcode, price) one at a time, so that I can add a single new SKU without a spreadsheet.
25. As an owner, I want to upload a CSV/spreadsheet of products in bulk, so that I can populate the initial catalog (hundreds to low-thousands of SKUs) practically.
26. As an owner, I want per-row error feedback on a bulk import (e.g., duplicate barcode, bad price), so that I can fix only the bad rows instead of guessing what failed.
27. As an owner, I want to edit a product's price, brand, active flag, or low-stock threshold, so that I can keep the catalog current without recreating products.
28. As an owner, I want to set a shop-wide default low-stock threshold and override it per product, so that fast- and slow-moving SKUs can have different alert points.
29. As an owner, I want to create receiver_user and cashier_user accounts (name, phone, PIN/password) for my staff, so that each staff member logs in with their own persistent credentials.
30. As an owner, I want to see a list of my shop's staff accounts, so that I know who has access.
31. As an owner, I want to reset a staff member's PIN/password, so that I can recover their access without an email-based flow.
32. As an owner, I want to view and edit shop-level config (GSTIN, excise duty rate, default low-stock threshold), so that invoices reflect my shop's actual registration and tax details.
33. As an owner, I want to use one account to perform receiver, cashier, and owner-only actions, so that I can fill in wherever needed without separate logins.
34. As a superadmin, I want a separate login (username + password, not the shop PIN flow), so that cross-shop support access is distinct from shop-level staff accounts.
35. As any authenticated user, I want role-inappropriate screens/actions to be hidden or blocked in the UI (backed by the server-side 403 that already exists), so that the interface doesn't invite actions I'm not permitted to take.
36. As a low-literacy user, I want every screen to use large touch targets, linear one-action-per-screen flows, and strong color/icon feedback (not just text) for success/error, so that I can operate the system confidently regardless of computer literacy.
37. As an owner using a tablet or narrower desktop window, I want the sidebar to collapse into a drawer and cards to reflow into fewer columns, so that the dashboard stays usable off a full desktop monitor.

## Implementation Decisions

- **Stack**: React + Vite + TypeScript, styled with Tailwind CSS configured to match `barstock_design.md`'s tokens (colors, typography scale, spacing, radii) as the Tailwind theme, not ad hoc utility classes. This is a client-side SPA — no server-side rendering — because D-29's write-queue and D-30's client-cached catalog both require persistent client-side state and logic between page loads.
- **Location**: new top-level `frontend/` directory, sibling to `app/`. It is a separate deployable unit from the FastAPI backend, consuming the backend purely over its versioned REST API — no shared runtime, per R-11/D-31's "not tightly coupled to one frontend" requirement.
- **API client**: generated from the backend's existing OpenAPI schema (`/openapi.json`) rather than hand-written request functions, so the frontend's request/response types stay in sync with the backend contract as it evolves. Regeneration is a build-time step, not a runtime dependency.
- **Auth**: two distinct login flows matching the two backend login endpoints — a large-digit PIN pad for shop-scoped logins (owner/receiver_user/cashier_user, phone + password/PIN) matching the `login_pin_pad` mockup, and a plain username/password form for superadmin login. JWT is held in memory/short-lived storage on the client; role is read from the token to drive which screens/nav items render (client-side hiding only — the existing server-side 403s remain the actual authorization boundary, R-21).
- **Screen inventory** (mockup-backed screens are pixel-faithful to `docs/frontend_initial/`; the rest are new screens built in the same design system since no mockup exists):
  - PIN login (mockup: `login_pin_pad`)
  - Checkout / sales counter — cart, scan, manual-entry fallback, remove line, payment mode selection (single or split), finalize, on-screen invoice preview, PDF download (mockup: `checkout_sales_counter`)
  - Stock receiving / new lot — scan or manual-entry, +/- quantity, save lot (mockup: `stock_receiving_new_lot`)
  - Owner dashboard / EOD — KPI cards, hourly sales chart, low-stock list, void-approval queue, mark-day-end action, past sign-offs list (mockup: `owner_dashboard_eod`)
  - Product catalog — list/search, create, edit, per-product threshold override (new; no mockup)
  - Bulk product import — CSV upload, per-row error report (new; no mockup)
  - Staff management — list staff, create receiver/cashier account, reset PIN/password (new; no mockup)
  - Shop config — GSTIN, excise duty rate, default low-stock threshold (new; no mockup)
- **Connectivity/offline behavior**: cart-building is fully client-side and unaffected by connectivity (D-42 — an unfinished cart is not persisted across a crash, by design). The checkout finalize call carries the existing `Idempotency-Key` header; on a network failure the frontend queues the request in `localStorage` and retries automatically on reconnect. A retry that fails invariant checks server-side (e.g., stock changed) surfaces a specific, visible error on the checkout screen rather than failing silently (D-29, R-14).
- **Product catalog cache**: on login/shift start, the frontend fetches the shop's product list once and caches it client-side for barcode-to-product resolution during scanning, avoiding a network round trip per scan (D-30). The cache is refreshed on a reasonable interval and after any catalog-changing action (create/edit/import) performed in the same session.
- **Responsive strategy**: per `barstock_design.md` §3 — fixed sidebar on desktop, sidebar-as-drawer + 2-column cards on tablet, single-column with bottom nav on mobile. Touch targets remain a minimum 48-64px per the design system regardless of breakpoint.
- **No new backend endpoints**: every planned screen maps to an existing router (`auth`, `checkout`, `lots`, `dashboard`, `voids`, `staff`, `products`, `shops`, `users`) confirmed present in the current backend; this PRD is scoped to frontend work only.

## Testing Decisions

- **Seam**: browser-driven end-to-end tests (Playwright) against the built frontend running with the real FastAPI backend and real Postgres — the single highest seam, mirroring the backend's existing real-database-per-test approach (`tests/conftest.py`) rather than adding a second, lower, mocked-API testing seam.
- Good tests here exercise only externally observable behavior: what appears on screen and what state results in the real backend (e.g., "after scanning barcode X and finalizing, GET /invoices/{id} shows the expected line and the product's stock decremented by 1") — never internal component state or implementation details of a specific React component.
- Coverage should include at minimum one full happy-path e2e flow per role: cashier login → scan → finalize → PDF download; receiver login → new lot → save; owner login → dashboard view → mark day end → view past sign-offs; owner → create product → bulk import → per-row error surfaced; owner → void-approval queue → approve/reject; owner → create staff account → reset PIN.
- Concurrency/invariant correctness (stock never negative, immutable finalized lines, idempotent retry) is already covered by the backend's own test suite per R-30; frontend e2e tests verify the UI correctly surfaces the outcomes of those invariants (e.g., the specific error shown when a queued checkout retry hits `insufficient_stock`), not the invariants themselves.
- Prior art: `tests/conftest.py` provisions a clean schema per test — the frontend e2e setup should reuse this pattern (spin up the real backend against a clean test schema before each e2e run) rather than inventing a separate fixture strategy.

## Out of Scope

- Any new backend endpoint, schema change, or business-logic change — this PRD is frontend-only; the backend surface is frozen as-is (issues #1-#8).
- Tablet/mobile native app — this is a responsive web app only, matching D-9's "web only for v1, API designed to support it later."
- Payment gateway UI (QR generation, live payment confirmation) — payment mode is recorded only, per D-40; no new UI beyond mode selection is implied.
- Physical receipt-printer integration — PDF-only, per D-62.
- Any UI for OSBCL track-and-trace, discounts/rounding, customer credit/dues, or Tally export — these remain out of scope per the frozen backend PRD's deferred-items table.
- Design of a fifth+ mockup by an external design tool — new (unmocked) screens are built directly in code against the existing design system tokens, not pre-designed as separate mockup artifacts first.

## Further Notes

- The frontend must consume the OpenAPI spec that already exists at the backend's `/docs`/`/openapi.json` — confirm the generated client's output location and regeneration command as part of initial scaffolding, so it's a repeatable step (e.g., an npm script) rather than a one-off manual generation.
- `docs/frontend_initial/barstock_pos_inventory` and `docs/frontend_initial/login_pin_pad` are duplicate mockups (both titled "Barstock - PIN Login," identical markup) — treat them as one screen, not two.
- Because the backend enforces authorization server-side (R-21), the frontend's role-based UI hiding is a UX convenience, not a security boundary — no frontend logic should be treated as sufficient access control on its own.
