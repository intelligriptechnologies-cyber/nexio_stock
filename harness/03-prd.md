# 03 — PRD: Barstock (liquor counter inventory & billing system)

## Problem statement

A friend's liquor retail shop in Odisha, India needs a system to run its counter operations end to end: receive stock in labeled lots, sell products via barcode scan across multiple simultaneous billing counters, record payment mode, reconcile the day's cash/UPI/card totals at close, and maintain the audit trail a regulated, cash-heavy retail business needs. The system must be usable by low-computer-literacy staff and hold up to real transaction volume (2-3 concurrent counters, ~2000 invoices/day combined).

## Goals

- Replace ad hoc/manual tracking with a scan-driven workflow for stock receiving and sales.
- Give the owner same-day visibility into sales volume, revenue, and cash/UPI/card split.
- Enforce stock and financial correctness (no overselling, immutable finalized records, auditable corrections) under concurrent multi-counter load.
- Be usable without computer literacy at the cashier/receiver level.
- Be "competitively good" against existing commercial liquor-POS products (VasyERP, Kamiti, Romio), not just a bare-minimum wishlist implementation.

## Non-goals (v1)

- Payment processing / money movement (no gateway, no UPI-API, no card-terminal integration) — the app records payment mode only (D-40).
- Odisha OSBCL track-and-trace / government portal integration (D-22).
- Customer credit/dues tracking — "credit" in the original ask meant credit card, not customer credit (D-15).
- Tablet/mobile client (may follow later, D-9).
- SMS/WhatsApp/email notifications (in-app only, D-33).
- Accounting-software export, e.g. Tally (D-44).
- System-enforced age verification (policy/training matter, D-24).
- True offline operation with no connectivity (client queues and retries instead, D-8/D-29).

## Requirements by branch

### Users and personas
- **R-1**: Four roles exist — `superadmin`, `owner`, `receiver_user`, `cashier_user` — each shop-scoped except superadmin (D-13, D-3, D-35).
- **R-2**: `receiver_user` can only create/manage stock Lots; `cashier_user` can only run checkout/invoicing; neither can perform the other's action (D-25).
- **R-3**: `owner` has superset permissions (can act as receiver or cashier, plus manage products/prices/thresholds and view reports) via one account, no separate logins needed (D-26).
- **R-4**: `receiver_user`/`cashier_user` are full persistent accounts (name, phone, PIN/password) created once by the owner and reused via normal login — not re-registered per shift (D-27).
- **R-5**: `superadmin` has cross-shop access for support/debugging; every superadmin action is written to the audit log and visible to the affected shop's owner (D-28, R-16).

### Core domain model
- **R-6**: `Lot` is a first-class entity: a stock receipt event with date, receiving user, and line items+quantities received. Per-SKU stock is derived from lots received minus sold (D-17).
- **R-7**: Each bottle size of a brand is a separate `Product` record with its own barcode, price, and stock count (D-19).
- **R-8**: `Invoice` lifecycle: Open cart (mutable) → Finalized+Paid (payment mode recorded, line items immutable) → Void, either pre-signoff (direct) or post-signoff (compensating reversal entry with owner approval) (D-18, D-37).
- **R-9**: Hard invariants enforced by the system at all times: stock quantity never goes negative; finalized invoice line items are immutable; every invoice line resolves to a real, in-stock product at scan time (D-20).
- **R-10**: Barcode/SKU identity uses whatever barcode is already printed on the bottle, scanned as-is; manual entry is the fallback when unreadable/absent — no sticker-generation pipeline in v1 (D-7).

### Backend / API surface
- **R-11**: Backend is Python, managed with `uv`, exposing a general-purpose, versioned, OpenAPI/Swagger-documented REST API not tightly coupled to one frontend (D-11, D-31).
- **R-12**: Scan-time product lookup uses a locally-cached catalog (no per-scan network round trip); checkout submits the full cart as one idempotent batch call performing stock-check + invoice creation atomically (D-30).
- **R-13**: Stock decrement at checkout finalize must be concurrency-safe (DB-level locking/transactions) to support 2-3 concurrent billing counters without overselling (D-39, R-9).
- **R-14**: On connectivity loss, cart-building stays client-side; the finalize call queues locally and retries on reconnect. A queued call that now fails invariant checks (e.g., stock changed) surfaces a clear error to the cashier rather than silently failing or double-selling (D-8, D-29).
- **R-15**: EOD reconciliation is a manual, staff-triggered action, not a scheduled job; low-stock checking is a background scheduled job (D-32, D-33).

### Data and persistence
- **R-16**: An explicit `audit_log` records user, action, timestamp, and affected record for key actions: lot received, invoice finalized, void requested/approved, superadmin cross-shop access (D-46).
- **R-17**: `shop_id` is present on every relevant table from the first migration, even with one shop at launch (D-35, D-3).
- **R-18**: Two-tier sales storage: a working/"concurrent" table holds the current day's in-progress transactions; on EOD sign-off, that day's rows move into a locked `confirmed_sales` table (D-36).
- **R-19**: No automatic data deletion — retain indefinitely (D-36).
- **R-20**: Central cloud-hosted database (e.g., Supabase or Railway Postgres) — no per-shop local database (D-8).

### Auth, security, privacy
- **R-21**: Role-based authorization matching R-1 through R-5, enforced server-side, not just hidden in the UI.
- **R-22**: Per-person login (PIN/password) at the counter, reconciled against D-38's low-literacy constraint — exact login UX (e.g., large PIN pad vs typed password) is an implementation detail to resolve in design, not fixed here.

### Frontend / UX
- **R-23**: The entire UI is designed for low-computer-literacy users: minimize free-text entry (prefer scan/tap/select), large/clear controls, linear step-by-step flows, strong visual (not just textual) feedback for success/error (D-38). This is a first-order constraint across every screen, not just checkout.
- **R-24**: Checkout screen: scanner-driven, cart shows scanned items with brand/price running total; cashier can remove a wrongly-scanned item before finalize (D-43); one clear "confirm/checkout" action.
- **R-25**: Lot-receiving screen: receiver scans/enters items and quantities for a new lot.
- **R-26**: Owner dashboard: EOD totals (sales count, revenue, cash/UPI/card split), low-stock list, void-approval queue.
- **R-27**: Manual barcode entry is a plain fallback field at both checkout and receiving, per R-10.

### Failure modes and recovery
- **R-28**: An in-progress (pre-finalize) cart is not persisted — a crash/power loss loses only the unfinished cart, no data-integrity impact since nothing is committed until finalize (D-42).
- **R-29**: See R-14 for the connectivity-drop / queued-retry behavior.

### Testing strategy
- **R-30**: Standard TDD per Superpowers execution phase; specific correctness tests are needed for the three hard invariants (R-9), concurrent-counter stock decrement (R-13), and the void/reversal flow (R-8). Excise/GST tax-line calculation tests are blocked until D-23's exact Odisha duty structure is confirmed — flagged as a pre-implementation research task, not deferred scope.

### Performance and scale
- **R-31**: System must sustain ~2000 invoices/day combined across 2-3 concurrent billing counters at peak without checkout-loop latency degradation (D-39, D-4).

### Deployment and operations
- **R-32**: Hosted on Supabase or Railway; the developer (superadmin) is the informal on-call contact for the friend's shop, no formal SLA in v1 (D-45, D-8).

### Compliance and constraints
- **R-33**: GST-registered invoice with GSTIN field and a tax breakup line — but see the flagged caveat below: alcohol is outside GST in India, so this line is most likely an Odisha state excise duty/VAT figure, not a standard GST slab. **Exact duty structure must be confirmed before this is implemented** (D-23).
- **R-34**: Odisha excise stock-register expectations are addressed structurally by Lot-level tracking (R-6); OSBCL track-and-trace/CCTV integration is explicitly out of scope for v1 (D-22).
- **R-35**: No system-enforced age verification (D-24).

### Docs and onboarding
- **R-36**: Given R-23's low-literacy constraint, in-app guidance should lean on visual/step-by-step UI design itself rather than written help text; developer-facing docs are covered by the OpenAPI/Swagger spec (R-11). No further onboarding requirement identified in grilling — treated as a low-priority default, not blocking.

## Roles summary

| Role | Scope |
|---|---|
| superadmin | Cross-shop, dev/ops only, all actions audited (R-5) |
| owner | Full shop-scoped access: receiving, checkout, reports, product/price/threshold management, void approval (R-3) |
| receiver_user | Stock receiving (Lots) only (R-2) |
| cashier_user | Checkout/invoicing only (R-2) |

## Deferred items and their v1 defaults

| Item | v1 default | Ledger ref |
|---|---|---|
| OSBCL track-and-trace / government portal integration | Not built; revisit once confirmed with shop/excise dept | D-22 |
| Payment gateway / UPI-API / card terminal integration | Record payment mode only, manual reconciliation | D-40 |
| Customer credit/dues tracking | Not built — "credit" meant credit card | D-15 |
| Tablet/mobile client | Web only for v1; API designed to support it later | D-9, D-31 |
| SMS/WhatsApp/email alerts | In-app notification only | D-33 |
| Accounting software export (e.g. Tally) | Not built | D-44 |
| System-enforced age verification | Policy/training only | D-24 |
| Cart persistence across crash | Not built — unfinished cart is simply lost | D-42 |
| Exact excise duty structure / GST line format | Placeholder tax line; must be confirmed with Odisha excise rules before ship | D-23 |
| Distinct product catalog size | Assume several hundred–low thousands of SKUs pending real data | D-5 |

## Appendix: Decisions ledger (verbatim)

# 02 — Decisions Ledger

Format: `D-<n> | decision | alternatives rejected | reasoning`

## From Phase 0 confirmation (2026-07-06)

D-1 | "Punch in / punch out" = stock check-in (receiving inventory) vs stock check-out (a sale). No staff attendance feature. | Literal attendance-tracking feature | User confirmed this reading directly.

D-2 | First real deployment target is a friend's liquor shop (real user, real money, real excise obligations — not a toy/demo). | Personal sandbox/demo-only build | User stated a friend's shop will use the product. Raises the bar on correctness, compliance, and reliability from day one.

D-3 | Roles in v1: **owner**, **cashier_user**. Single shop for now, but data model must support adding shop 2..N later (multi-tenant-ready from the start). | Single-shop-only hardcoded model | User explicit: "single shop but option to add shop no2...N later."

D-4 | Expected volume: **~2000 invoices/day** at a single counter. | Assuming low-volume small-shop scale | User-provided number. This is high enough to shape architecture: needs a fast checkout scan loop, indexed lookups, and reporting queries that aggregate thousands of rows/day without lag.

D-5 | Distinct product catalog size: unknown, assume "typical large Indian liquor off-shop" scale (treat as several hundred to low thousands of SKUs) until real data is available from the friend's shop. | Guessing an exact number | User: "no idea like any good liquor off shop." Deferred — default assumption stated here; revisit once real catalog is loaded.

D-6 | GST and excise compliance is **in scope for v1**, not deferred. Exact excise report formats (state-specific in India) need research before PRD freeze. | Treating compliance as a v2/later add-on | User: "we need to be compliant." Non-negotiable per user — liquor is a regulated good in India, and state excise departments have specific stock-register/reporting formats.

D-7 | Barcode/SKU identifier: no printed-sticker generation pipeline in v1. Use whatever barcode/UPC is already printed on the bottle as the unique SKU identifier, scanned as-is. If unreadable/absent, manual entry fallback assigns/enters the code. | Auto-generating and printing new barcode stickers per product (as originally floated in the raw wishlist) | User: "label is for now whatever on bottle to identify the sku unique one... if not legible by scanner option to enter manually." This **reverses** the original wishlist item ("ready made barcode will be generated and stickers... prepared") — flagging this as a change from the original ask, not just a clarification.

D-8 | ~~offline-first with local DB~~ **CORRECTED in Phase 2 grill** — single **central, cloud-hosted database** (e.g., Supabase or Railway Postgres). No local backend/DB runs at the counter. The earlier "offline first ops" phrasing is now understood as "the app should degrade/queue gracefully on connectivity drops," not "run fully independent of the internet" -- exact degradation behavior is the next open question. | Local backend+DB per shop, syncing to a central server (originally recommended, rejected by user) | User: "local db not needed we will have a central db hosted online like supabase or railway." This simplifies ops (D-12) significantly -- no per-shop server install/maintenance -- but raises the stakes on Q9.1-style questions: what happens to an in-progress cart if the counter's internet drops mid-checkout, given there's no local fallback DB?

D-9 | Primary device: PC/laptop at the counter. Tablet support is a possible future addition, not v1. | Mobile-first or tablet-first design | User explicit.

D-10 | Platform: web application. | Native desktop or mobile app | User explicit.

D-11 | Backend: **Python**, managed with **uv**, exposing an **OpenAPI/Swagger**-documented API. Frontend: unspecified framework yet, but must be "secure." | Other backend stacks (Node, Go, etc.) | User explicit stack preference.

D-12 | Bar for v1 quality: "competitively good" relative to commercial products (VasyERP, Kamiti, Romio, etc.), even though initial deployment is just for a friend's single shop. Borrow/backfill features from competitors where the original wishlist under-specified something. | A stripped-down MVP that only covers the literal wishlist | User: "we want us to be competitively good even if it is just for a friend... borrow features os competitors if we missed." This changes v1 scope significantly — see D-13 open question about what "complete" means in measurable terms.

D-13 | Roles expanded beyond owner/cashier: **superadmin** (the dev team, presumably for multi-tenant/ops support), **owner**, **receiver_user** (registers a stock lot received on a given day/time), **cashier_user**. Receiver and cashier described as needing similar "registration" capability. | Two-role model (owner + cashier only) | User explicit list of 4 roles. Note: receiver_user's exact permissions vs cashier_user need to be disambiguated — flagged for Phase 2 grill.

D-14 | Low-stock alerting is in scope for v1. | Deferred to v2 | User explicit: "low stock alert."

D-15 | ~~Payment modes: Cash, UPI/Bank, and Credit (dues)~~ **CORRECTED** — Payment modes are **Cash, UPI, and Credit Card** (all point-of-sale payment methods, no dues/customer-credit-balance concept). "Credit" meant credit card, not credit sales to a customer. | Interpreting "credit" as customer dues/credit-sales (see Q2.2, corrected in Phase 2 grill) | User clarified directly during grilling: "i meant credit card, upi and cash." No Customer/dues entity needed for payments — this removes the credit-customer-entity question entirely.

D-16 | Geographic/regulatory focus: **India**, for now (single-country scope; no immediate need for multi-country tax/excise abstraction). | Multi-country from day one | User explicit: "we are india focused as of now."

## From Phase 2 grill (2026-07-06)

D-17 | Lot is a first-class entity: each stock receipt creates a Lot record (date, receiver, items+quantities). Per-SKU stock quantity is derived from lots received minus sold; every sale traces back to (or at least depletes) a lot. | Flat per-SKU quantity counter with no batch history | User accepted recommendation. Enables traceability and matches excise stock-register expectations of batch/lot-level receipt records (Q13.2 will confirm exact state format later).

D-18 | Invoice lifecycle: Open cart (mutable, items can be removed) -> Finalized+Paid (checkout records payment mode, line items become immutable) -> Void (a separate action can cancel a finalized invoice, restoring stock, preserving full audit trail rather than editing in place). | No void capability in v1 (manual/offline fix for mistakes) | User accepted recommendation. Handles customer returns and cashier mistakes without breaking the immutability/audit-trail requirement on finalized invoices.

D-19 | Each bottle size (180ml/375ml/750ml etc.) of a brand is a fully separate Product record with its own barcode, price, and stock count -- no shared "parent brand" entity with size variants. | One Product per brand with a size attribute and child barcode mappings | User accepted recommendation. Matches real-world bottles, which already have size-specific barcodes printed by the manufacturer (D-7) -- no extra modeling needed.

D-20 | Three hard invariants enforced by the system: (1) stock quantity can never go negative -- checkout is rejected if requested qty exceeds current stock; (2) finalized invoice line items are immutable, corrections go through Void (D-18) not in-place edit; (3) every invoice line must resolve to a real, in-stock Product at scan time -- unknown/out-of-stock scans are rejected or flagged, never silently added. | Allowing manual overrides/negative stock for flexibility | User accepted all three recommended invariants, none of the "allow overrides" option. These are the correctness backbone the rest of the schema and API must guarantee.

D-21 | Shop location: **Odisha**, India. Excise compliance research scoped to Odisha State Excise Department rules. | Generic multi-state placeholder | User provided directly.

**Research finding (flagged, not yet a decision):** Odisha's new Excise Policy 2026 (effective 2026-04-01, in force through 2029-03-31) introduces a "track and trace" system for bottle-level tracking from distillery through bottling to retail sale, plus CCTV surveillance at retail outlets linked to Excise Commissioner offices. This strongly suggests bottles sold in Odisha may already carry an **official excise-mandated barcode/QR code** (via OSBCL, the state beverages corporation) rather than a generic manufacturer UPC -- which would directly affect D-7 (using whatever barcode is already on the bottle). Odisha State Excise Department site: stateexcise.odisha.gov.in. Exact stock-register format and whether retail POS systems must integrate with the track-and-trace system was not found in this search pass -- needs a follow-up question to the user/friend's shop before PRD freeze, since this could be a hard integration requirement, not just a report-format detail.

D-22 | Odisha OSBCL track-and-trace/CCTV integration is **explicitly deferred**, not v1 scope. v1 proceeds with D-7 as-is (scan whatever barcode is on the bottle, manual fallback). This will be listed in the PRD as a named deferred item to revisit once confirmed with the friend's shop/excise dept. | Blocking further design until the integration requirement is confirmed | User: "not sure -- treat as v1 unknown, default to generic barcode." Avoids stalling the whole project on an unconfirmed government-integration requirement.

D-23 | Shop is GST-registered; invoices need a GSTIN field and a tax breakup line. **Caveat to verify before PRD freeze:** alcohol for human consumption is constitutionally outside GST in India -- it's taxed via state excise duty/VAT instead, not standard CGST/SGST. The invoice's "tax breakup" is most likely an Odisha excise duty/VAT line, not a GST slab -- needs one more confirmation pass (exact duty structure) before the PRD's invoice format is finalized. | Assuming standard GST slabs apply | User chose GST-registered path; flagging the alcohol-GST-exemption fact discovered during this same turn so the PRD doesn't ship an incorrect tax model.

D-24 | Age verification is a manual/policy matter for cashier training, not a system-enforced step -- no per-invoice age-check UI/audit field in v1. | System-enforced age-verified checkbox per invoice | User accepted recommendation. Keeps checkout fast at 2000 invoices/day volume; matches how real liquor counters operate and how competitor products are built.

D-25 | Strict role split: receiver_user can only create/register stock Lots (no checkout access); cashier_user can only run checkout/invoices (no stock-receiving access); owner can do both plus view reports, manage products/prices, manage low-stock alerts; superadmin is dev/ops-only with no day-to-day shop operations. | Overlapping roles where either can do either (roles only for audit-log attribution) | User accepted recommendation. Gives real access control rather than just labeling, appropriate given this handles a friend's real money/regulated goods (D-2, D-6).

D-26 | Owner's account has full permissions (superset of receiver+cashier) -- can act in any role without a separate login. Cashier and receiver accounts remain strictly single-role. | Strictly one role per account with no exceptions, even for owner | User accepted recommendation. Matches small-shop reality (owner fills in wherever needed) without weakening the receiver/cashier boundary from D-25.

D-27 | Receiver_user/cashier_user accounts are full persistent accounts (owner creates once per staff member: name, phone, PIN/password), reused daily via normal login -- not a fresh per-shift registration. A Lot simply records which existing receiver_user account received it. | Lightweight per-shift check-in with no persistent credentials | User accepted recommendation. Simpler data model, real auth/access control (matches D-25/D-26), still gives per-person audit trail without re-registering staff every day.

D-28 | Superadmin has global cross-shop access for support/debugging, but every superadmin action is written to the same audit trail and visible to the affected shop's owner. | Silent/invisible global superadmin access | User accepted recommendation. Balances real operational need (dev team supporting a live shop) against trust, given this handles a friend's real business (D-2).

D-29 | Connectivity-drop handling: cart-building stays fully client-side (works regardless of connectivity); the checkout/finalize API call queues in browser local storage if unreachable and auto-retries on reconnect. Stock/invariant checks (D-20) happen server-side at finalize time, so a queued checkout can fail on reconnect (e.g., stock changed meanwhile) -- cashier sees a clear error to resolve manually, not a silent double-sell. | Hard-blocking checkout entirely while offline | User accepted recommendation. Pragmatic middle ground given D-8's correction (no local backend) -- avoids total sales stoppage during a brief outage without pretending to be a true offline-capable system.

D-30 | Scan-time product lookup uses a locally-cached product catalog (no network round-trip per scan). The full cart is submitted as one idempotent batch checkout call at finalize time, which performs stock-check (D-20) and invoice creation atomically. Checkout requests carry an idempotency key so a retry (e.g., from D-29's queued-write replay) can't double-sell. | One API call per individual scan | User accepted recommendation. Keeps the scan loop fast and network-round-trip-free at 2000 invoices/day, and pairs naturally with D-29's queued-write retry behavior.

D-31 | API is built as a general-purpose, versioned, OpenAPI-documented REST surface, not tightly coupled to the current web frontend's exact response shapes. | Optimizing purely for the current web frontend, revisiting generality only when a second client is actually built | User accepted recommendation. Low extra cost now given D-11 already requires Swagger docs; avoids rework when tablet/mobile support (D-9) materializes.

D-32 | End-of-day reconciliation is a manual, staff-triggered action ("mark day end") rather than an automatic nightly background job -- owner/cashier explicitly closes out the day, which computes and locks that day's totals. | Automatic nightly scheduled job that runs regardless of user action | User: "staff will be marking day end." This means EOD is a synchronous user-triggered operation, not async/background -- simplifies infra (no scheduler needed for this specific feature). Low-stock alerting (still open, see below) may or may not need a separate background check.

D-33 | Low-stock alerting runs as a background scheduled job (periodic check against threshold), with **in-app notification only** in v1 (badge/banner visible when owner opens the app) -- no external SMS/WhatsApp/email gateway. | On-demand-only check with no background job; or background job + external SMS/WhatsApp notification | User wants proactive background checking (not on-demand-only) but chose the in-app-only channel over external messaging to avoid gateway integration cost/complexity in v1. Can add SMS/WhatsApp later without changing the underlying job logic.

D-34 | Low-stock threshold is per-product configurable, defaulting to a shop-wide setting for products that haven't been customized. | Single shop-wide threshold for all products | User accepted recommendation. Avoids one-size-fits-all thresholds being wrong for fast- vs slow-moving SKUs, without forcing manual config of every product on day one.

D-35 | shop_id is added as a column/foreign key on every relevant table from the very first migration, even though only one shop exists at launch. | Single-shop schema now, retrofit shop_id when shop 2 is actually onboarded | User accepted recommendation. Near-zero cost now vs. a genuinely painful migration on live production data later (D-3).

D-36 | Retention: **indefinite, no auto-deletion**. Additionally, a two-tier sales storage model: today's in-progress transactions live in a "concurrent"/working sales table; once EOD reconciliation is run and the owner/cashier signs off (D-32), that day's transactions move into a `confirmed_sales` table and become locked (immutable, matching D-18/D-20's immutability invariant, but now enforced at the storage-tier level, not just row-level). | Fixed retention window (e.g., 3-5 years) with auto-archival/deletion | User specified both retention (indefinite) and a concrete two-table architecture: working/concurrent table for the live day, `confirmed_sales` for locked, signed-off history. This is a stronger version of D-18's void-not-edit invariant -- once EOD sign-off happens, the day's rows physically move to a locked table, not just a status flag.

D-37 | Void is allowed even after EOD sign-off, via a compensating/reversal entry (the original locked confirmed_sales row is never edited/deleted; a new reversal entry references it). Requires an approval workflow: the cashier/staff who handled the sale requests a void, and the **owner must approve** before the compensating entry is created. | Void allowed only before sign-off, no post-signoff corrections at all | User: "owner can approve the void as per checkout staff request." Balances real-world need for corrections after close against D-36's locked-record integrity, with an explicit human approval gate rather than letting any user reverse a locked sale unilaterally.

D-38 | **Major cross-cutting UX constraint:** target users (owner, cashier, receiver at the friend's shop) are described by the user as low computer literacy -- "this app should cater to users who don't know computer use basically." This overrides/refines D-11's vague "secure frontend" note and elevates domain 4 (Frontend/UX) to a first-order design constraint, not an afterthought. Concretely this likely means: minimal free-text data entry (prefer scan/tap/select over typing), very large/clear buttons and text, linear step-by-step flows (not dense multi-field forms), strong visual feedback (color/icon, not just text) for success/error states, and a checkout flow a non-technical cashier can complete purely by scanning + tapping "confirm." | Assuming a normal business-software UX baseline (standard forms, keyboard-driven data entry) | User stated this directly and unprompted, flagging it as "the problem" with the void-approval flow discussion -- meaning it applies far beyond just void, to every screen. This is significant enough to affect Q4.1-Q4.4 (checkout screen, lot-registration screen, manual-entry fallback) and should be a named non-functional requirement in the PRD, not just a design nicety.

D-39 | **CORRECTED (advisor-flagged, significant architectural fork):** ~2000 invoices/day is a combined total across **2-3 concurrent billing counters/cashiers** at peak, not one cashier at one counter. This means D-20's "stock can never go negative" invariant must be enforced with real concurrency safety (DB-level row locking or transactions on stock decrement at checkout finalize, per D-30's batch checkout call), not single-writer logic. D-29's queued-write retry on reconnect must also account for cross-counter conflicts (two counters both trying to sell the last unit of a SKU while one was offline). | Assuming a single-cashier, single-counter model (the original working assumption from D-4, now superseded) | User confirmed via direct question: "Multiple billing counters run concurrently," ~2-3 at peak. Caught by advisor review before PRD freeze -- this changes the domain model's concurrency story, not just a performance detail.

D-40 | Payment modes (Cash/UPI/Card, D-15) are **record-only** -- the app never touches actual money movement, no payment gateway/UPI-API/card-terminal integration. Cashier selects the mode used after payment is collected through the shop's existing means (owner's UPI app, card machine, cash drawer); EOD reconciliation (D-32) compares recorded totals per mode against the owner's own bank/UPI statements. | Real payment gateway integration (QR generation, API payment confirmation, card terminal integration) | User accepted recommendation (advisor-flagged as a scope question worth confirming explicitly). Keeps v1 scope bounded to what the original intake actually asked for (tracking + reconciliation, not payment processing) and matches how small Indian retailers operate today.

D-41 | **v1 scope frozen.** Complete v1 = product catalog + barcode assign/scan (D-7, D-19); lot receiving (D-17); multi-counter (2-3 concurrent) checkout/invoicing with cart (D-4/D-39, D-30); void/reversal with owner approval both pre- and post-EOD (D-18, D-37); Cash/UPI/Card mode recording only, no gateway (D-15, D-40); manual EOD sign-off locking sales into `confirmed_sales` (D-32, D-36); low-stock alerts via background job + in-app notification, per-product configurable threshold (D-33, D-34); 4 roles (superadmin/owner/receiver/cashier) with strict permission boundaries (D-13, D-25, D-26, D-28); low-literacy-friendly UI as a first-order constraint (D-38); GST/excise-duty line on invoices for Odisha, exact duty structure TBD (D-23). Explicitly deferred/out of scope: OSBCL track-and-trace integration (D-22), payment gateway/UPI-API integration (D-40), customer credit/dues (superseded by D-15 correction), tablet/mobile app (D-9), SMS/WhatsApp alerts (D-33), age-verification system step (D-24). | Leaving "complete software" open-ended | User confirmed this list is complete. This is the definition-of-done the PRD and Phase 5 slices must trace back to -- resolves the open thread flagged in Phase 0/1 and by the advisor review.

D-42 | In-progress cart (pre-checkout) is not persisted -- a crash/power loss before finalize just loses the unfinished cart, cashier re-scans. No data-integrity risk since nothing is committed until the D-30 batch finalize call. | Persisting in-progress cart state (e.g., browser local storage) to survive a crash | User accepted recommendation. Not worth the complexity for a relatively rare event with no downstream data risk.

D-43 | Cashier can freely remove a wrongly-scanned item from the in-progress cart before checkout -- pure frontend operation, no backend/audit trail implication since nothing is committed pre-finalize (D-30). | Append-only cart requiring a full post-hoc void (D-18) for scan mistakes | User accepted recommendation. Obviously necessary for a common real-world mistake (double-scan/wrong item).

D-44 | No accounting-software export (e.g., Tally) in v1 -- the app's own EOD/reporting (D-32, D-41) is the sole source of truth. | Building a Tally or similar export now | User accepted recommendation. Avoids guessing at an export format/need nobody has actually asked for; revisit if the owner's real bookkeeping workflow needs it later.

D-45 | Hosting/on-call: the dev (superadmin) hosts on Supabase/Railway (D-8) and is the informal on-call contact if the friend's shop's system goes down -- no formal SLA. | A more formal shared-responsibility or uptime-SLA arrangement | User accepted recommendation as reasonable for a friend's-shop-scale v1; can formalize later if this grows to more shops (D-3).

D-46 | Explicit `audit_log` table/feature in v1 scope: records user, action, timestamp, and affected record for key actions (lot received, invoice finalized, void requested/approved, superadmin cross-shop access). Formalizes what D-28 and D-37 already implicitly require. | Relying only on per-table created_by/updated_at fields, no unified log | User accepted recommendation. Makes D-28's owner-visible superadmin access and D-37's void-approval trail straightforward to query/display rather than implicit assumptions.

## Open threads carried into Phase 2 (not yet resolved, just surfaced)

- ~~Offline-first sync strategy...~~ RESOLVED — no local DB; central cloud DB with client-side write-queue on connectivity drops (D-8 corrected, D-29).
- ~~receiver_user vs cashier_user boundaries~~ RESOLVED — strict split, no overlap (D-25).
- ~~Credit sales: who is credit extended to...~~ RESOLVED — "credit" = credit card payment mode, not customer dues. No customer-credit-balance entity needed (D-15 corrected).
- ~~Excise/GST compliance state~~ RESOLVED — Odisha (D-21); exact excise duty structure and OSBCL track-and-trace requirement still need confirmation from the shop/excise dept before invoice tax-line implementation (D-22, D-23 caveat) — this is a pre-implementation research task, not an open design question.
- ~~"Complete software is v1" definition~~ RESOLVED — frozen feature list (D-41).
- ~~Low-stock alert threshold definition~~ RESOLVED — per-product configurable with shop-wide default (D-34), background job + in-app notification (D-33).
- ~~Multi-shop schema decisions~~ RESOLVED — shop_id on every table from day one (D-35).
