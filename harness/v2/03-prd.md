# v2 PRD: Provisional product quick-add, quicksearch, and PIN-only staff login

## Problem Statement

Barstock's counter staff hit two friction points in daily use, and the owner wants one UX simplified:

1. **New stock blocks on the owner.** When a receiver scans a barcode Barstock doesn't recognize, receiving is flatly rejected ("unknown or inactive barcodes"). The same happens if a cashier ever scans something unrecognized at checkout. Every brand-new SKU has to go through the owner's product-creation screen before the very first bottle can be logged in — a real bottleneck when stock arrives and the owner isn't immediately available.
2. **Scanning is the only way in.** Both the receiving and checkout screens only accept a scanned/typed barcode — there's no way to find a product by typing its name, which matters when a barcode is smudged, missing, or the staff member just doesn't have it handy.
3. **Login is slower than it needs to be.** Shop-scoped staff (owner/receiver/cashier) log in by typing their phone number, then their PIN. The owner considers the phone-number step unnecessary friction — staff PIN secrecy is the actual security boundary, not staff-name secrecy, so identifying yourself from a list of names is an acceptable trade for speed.

Separately, two known-incomplete items from the shipped v1 build should stay visible rather than sit forgotten in closed GitHub issues: the GST/excise invoice line is a placeholder pending a real Odisha duty-rate confirmation, and superadmin's cross-shop product lookup is unscoped pending a second shop actually existing.

## Solution

- Let `receiver_user`, `cashier_user`, and `owner` **quick-add** a brand-new product on the spot — brand + size only, no price — whenever a scan/search doesn't match the catalog, at both the receiving and checkout screens. The item is immediately usable for receiving (stock counts right away) but cannot be sold until the owner finishes it.
- Give the owner a single **Pending Products** screen listing every quick-added item awaiting a price; a dashboard badge shows the count. Completing a pending product (setting its price) *is* the notification being resolved — there's no separate dismiss action.
- Add a **quicksearch** box at both receiving and checkout that matches on barcode substring or brand-name substring against the already-cached catalog, so staff can tap a match instead of scanning.
- Replace shop login's phone-number entry step with a **tap-list of the shop's active staff** (name + role); PIN entry is unchanged. A new unauthenticated endpoint supplies the names (no phone, no password) for the one shop that exists today.
- Carry forward, as explicit tracked notes (no code change), the two known-incomplete v1 items described above.

## User Stories

1. As a `receiver_user`, I want to scan a barcode that isn't in the catalog and immediately log it as a new product with just its name and size, so that I don't have to stop receiving and go find the owner.
2. As a `receiver_user`, I want the quantity I just received for a brand-new product to count as real stock right away, so that the shelf count is accurate even before the owner sets a price.
3. As a `cashier_user`, I want the same quick-add option if I scan something unrecognized at checkout, so that I'm not stuck without a workaround.
4. As a `cashier_user`, I want a clear, specific message ("Pending — no price yet, contact admin") when a scanned item has no price yet, so I understand why I can't add it to the cart.
5. As a `cashier_user`, I want the rest of my sale unaffected by one pending item, so that I can keep ringing up everything else and finalize normally.
6. As an `owner`, I want one screen listing every product that's been quick-added and still needs a price, so I always know what's waiting on me.
7. As an `owner`, I want a badge/count on my dashboard showing how many products are pending, so I notice it without hunting for it.
8. As an `owner`, I want setting a pending product's price to be the entire "resolving" action — no extra dismiss step, so completing my one job (pricing it) is all that's required.
9. As an `owner`, I want a quick-added product that came from checkout to still require an actual stock receipt before it can be sold, so my stock records never show a sale with no corresponding delivery.
10. As a `receiver_user` or `cashier_user`, I want to type part of a product's name or barcode into a search box at receiving/checkout and tap the right match, so I'm not required to scan when a barcode is missing or hard to read.
11. As any shop-scoped staff member (`owner`/`receiver_user`/`cashier_user`), I want to see a list of my shop's staff names by role and just tap mine, instead of typing my phone number, so logging in is faster.
12. As any shop-scoped staff member, I want to enter only my PIN after picking my name, exactly like today's PIN pad, so the login flow stays just as fast for the actual credential check.
13. As a superadmin, I want my own login (username + password) to stay exactly as it is today, unaffected by the staff-login redesign.
14. As a developer maintaining Barstock, I want the still-placeholder GST/excise tax line and the still-unscoped superadmin cross-shop product lookup to be visibly tracked (not just buried in closed issue comments), so nobody assumes they were finished.
15. As two receivers/cashiers who happen to quick-add the same unrecognized barcode near-simultaneously, I want the system to reject the second attempt cleanly ("someone already added this") rather than crash or silently duplicate, so the catalog never ends up with two rows for one barcode.
16. As a receiver/cashier who double-taps "Add" by accident on a quick-add form, I want that to be a no-op rather than a confusing duplicate-error, so an ordinary UI mistake doesn't produce a scary error message.

## Implementation Decisions

**Domain model / schema**
- `Product` gains a `status` enum (`pending` | `active`); `price` becomes nullable, required only when `status = active`. Existing rows migrate to `active`. No separate staging table — a pending product is a first-class `Product` row everywhere (lots, stock views, catalog), just unsellable and unpriced.
- A pending product can be received into a `Lot` exactly like an active one; the received quantity counts as real stock immediately (existing `stockin_logs` entry, unchanged flow). Checkout is the only place that refuses a `pending` product.
- A pending product created during checkout (rather than receiving) still has zero stock until an actual `Lot` is later received for it — quick-adding at checkout never bypasses the "stock derived from lots" invariant. There's no special-cased checkout-created-and-priced-therefore-sellable path.

**Backend / API surface**
- Quick-add endpoint accepts brand + size_label only (no price, no threshold), creates a `pending` `Product`. Reuses the existing checkout-finalize idempotency-key pattern so a double-submit for one barcode is a no-op, and relies on the existing global barcode-uniqueness constraint as the ultimate backstop against a same-barcode race between two staff members — surfaced to the UI as a clean conflict message, not a raw error.
- A new **unauthenticated** endpoint (e.g. `GET /auth/shop-staff`) returns the one existing shop's active `owner`/`receiver_user`/`cashier_user` accounts as `{id, full_name, role}` only — no phone, no password hash. Scoped to today's single shop; a multi-shop selection step (e.g. shop code in the URL) is explicitly out of scope until a second shop is actually provisioned.
- No new backend search endpoint for quicksearch — it filters the catalog that's already fully cached client-side for barcode scan resolution.
- Quick-add creation is logged through the existing domain-specific log tables (`stockin_logs` when triggered from receiving, `invoicing_logs` when triggered from checkout) with `event_type = "product.pending_created"` — no new log table.

**Frontend / UX**
- Receiving screen (`ReceivingPage.tsx`) and checkout screen gain: (a) a quick-add action offered whenever a scan/search misses, taking brand + size only; (b) a quicksearch text input matching barcode-substring or brand-substring against the already-prefetched catalog, letting staff tap a result instead of scanning.
- New **Pending Products** screen (owner/superadmin-visible): lists brand, size, barcode, who added it, when, and whether it came from receiving or checkout. Setting a price (and optionally a low-stock threshold) there flips the row to `active` — that action is the entire resolution flow, no separate acknowledge step. Existing owner dashboard gains a badge/count sourced from this list.
- At checkout, a scan/search hit that resolves to `pending` (or fails to resolve at all) cannot be added to the cart; shows "Pending — no price yet, contact admin" and is skipped, leaving the rest of the in-progress sale untouched.
- `LoginPage.tsx`'s first stage changes from a phone-number entry field to a tap-list built from the new staff-list endpoint; picking a name carries that user's identity forward into the existing second stage (PIN pad), which is otherwise unchanged. `SuperadminLoginPage.tsx` is untouched.

**Carried-over tracking (no code change in this PRD)**
- GST/excise invoice tax line remains an owner-editable placeholder — still blocked on confirming Odisha's actual excise duty structure, not on any implementation work (originally shipped as a stub in closed issue #8).
- Superadmin's cross-shop product lookup (`GET /products`, `GET /products/lookup`) remains unscoped — could return the wrong shop's product if two shops ever share a barcode; moot today under the existing global barcode-uniqueness constraint, deferred until a second shop is provisioned (flagged in closed issue #19's caveats).

## Testing Decisions

- Backend behavior (status/price nullability transitions, quick-add idempotency and conflict handling, checkout rejecting `pending` products, staff-list endpoint scoping and field redaction, stock counting for pending products received into a lot) is tested at the API seam via `pytest` against the FastAPI app, following the existing pattern in `tests/test_products.py`, `tests/test_lots.py`, `tests/test_checkout.py`, and `tests/test_auth.py`. Only external behavior (request in, response/status out) is asserted — not internal function calls.
- UI-observable behavior (quick-add flow at both screens, quicksearch typing-and-tapping a result, the Pending Products screen and dashboard badge, and the new login tap-list-then-PIN flow) is tested at the Playwright e2e seam, following the existing pattern in `frontend/e2e/receiving.spec.ts`, `frontend/e2e/checkout.spec.ts`, `frontend/e2e/products.spec.ts`, and `frontend/e2e/login.smoke.spec.ts`.
- No new test seam is introduced — both seams already exist and already cover the exact screens/endpoints this batch touches.

## Out of Scope

- Physical damaged-stock write-off (broken/leaking bottle) — the "damage" ask was confirmed to mean the already-shipped unreadable-barcode manual-entry fallback, not a new stock-adjustment feature.
- A separate, independently-dismissible notification record — the Pending Products list itself is the notification surface.
- A server-side product search endpoint — quicksearch stays a client-side filter over the existing cached catalog.
- A multi-shop login-picker / shop-selection step — deferred until a second shop actually exists.
- Any real GST/excise duty-rate calculation — still blocked on an external confirmation, unchanged from v1.
- Cross-shop-safe superadmin product lookup — deferred until a second shop actually exists.
- Any other v1-adjacent feature not explicitly requested here (discounts, rounding, partial returns, SMS/email notifications, etc.) — all remain exactly as scoped in the frozen v1 PRD.

## Further Notes

- This PRD supersedes the earlier draft at `harness/v2/03-prd.md`; the full decision trail (D-v2-1 through D-v2-17) with alternatives-rejected reasoning lives in `harness/v2/02-ledger.md` and is not repeated here per the to-prd template's "no outdated file paths/snippets" guidance — but is the authoritative record if any implementation decision above needs its "why."
- The two carried-over tracking items (GST/excise placeholder, superadmin cross-shop lookup) are not actionable work items in this PRD — no issue/slice should be created for them; they're recorded here purely so they stay visible.
