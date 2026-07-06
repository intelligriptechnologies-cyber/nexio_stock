# Branch Map

Inputs: `00-intake.md` (confirmed) + `02-ledger.md` (D-1..D-16, plus 7 open threads already surfaced there). This fan-out does not re-ask anything already closed by a D-<n>; it expands into domains the intake conversation didn't reach yet.

## UNMAPPED wishlist items check

Cross-checking every capability against the intake's decomposition table and ledger: all originally-listed capabilities (product onboarding, barcode assign/scan, checkout/invoice, payment mode, invoice storage, EOD reporting) map to domains below. Two ledger additions also need homes: **credit sales** (D-15) → domains 2, 5, 11; **multi-role registration flow** (D-13) → domains 1, 6. Nothing is unmapped.

## 1. Users and personas

Implications: Four roles now exist — superadmin (dev/ops team), owner, receiver_user, cashier_user — across what may become multiple shops later (D-3). Receiver and cashier "register" things but their boundaries aren't yet distinct per D-13's open thread.

Open questions:
- Q1.1 Does superadmin operate per-shop or globally across all shops (support/debug access), and can an owner see/impersonate that access, or is it invisible to shop-level users?
- Q1.2 Exactly what can receiver_user do that cashier_user cannot, and vice versa? (e.g., can a cashier also receive stock if no receiver is on shift?)
- Q1.3 Can one physical person hold two roles (e.g., owner also acts as cashier on a quiet day), or are roles strictly one-account-one-role?
- Q1.4 Is there an onboarding/registration flow for adding a new receiver_user or cashier_user "for the day" as implied by "a way to register receiver that day time for the given lot" — is this a full user account, or a lightweight per-shift identity (e.g., a name tag on a lot without login credentials)?
- Q1.5 How are owner and cashier authenticated day to day — shared shop device login, or per-person login/PIN at a shared terminal?

## 2. Core domain model

Implications: Core nouns are clear at a high level: Product (brand, price, SKU/barcode), Lot/Stock-receipt (a batch received on a given day by a receiver), Invoice (list of scanned items + payment), Payment (mode: cash/UPI/credit), Shop (future multi-tenant root). Credit sales (D-15) introduce a new entity — likely a running balance tied to a customer or informal debtor — not yet modeled.

Open questions:
- Q2.1 Is "Lot" a first-class entity (a batch received on a date, with its own receiver and quantity) that stock/invoice line items trace back to, or is stock just a flat per-SKU quantity counter?
- Q2.2 For credit sales: is credit extended to a named/registered customer (needs a Customer entity with contact info) or can it be anonymous ("owner's cousin owes ₹500", tracked by free-text note)?
- Q2.3 What is the lifecycle of an Invoice? (e.g., draft/open cart → checked-out/finalized → paid → [voided/refunded]?) Is void/refund/return in scope at all?
- Q2.4 Does a Product have variants (bottle size — 180ml/375ml/750ml — of the "same" brand), and if so is each size a separate SKU/barcode, or one product with a size attribute?
- Q2.5 What are the core invariants that must never break? (e.g., stock quantity can never go negative; every invoice line must reference a valid in-stock item at scan time; a paid invoice's line items are immutable after checkout)

## 3. Backend / API surface

Implications: D-11 fixes Python + uv + OpenAPI/Swagger. At 2000 invoices/day (D-4) on a single counter, the checkout-scan loop is the latency-critical path; reporting/EOD endpoints are the aggregation-heavy path. Offline-first (D-8) means the API surface can't assume every write is synchronous to a central server.

Open questions:
- Q3.1 Does offline-first mean the counter PC runs a local backend/local DB that syncs to a central server later, or does the frontend queue writes client-side against one backend that's sometimes unreachable? This decision drives the entire API design (D-8's open thread).
- Q3.2 Are barcode-scan lookups and invoice-checkout separate API calls per item, or does the frontend batch a full cart into one checkout call? (Affects idempotency needs — what happens if a checkout call is retried after a network blip?)
- Q3.3 Versioning: is this API consumed only by the one frontend you control, or should it be designed for other future consumers (e.g., a future mobile app per D-9)?
- Q3.4 Async needs: does anything here warrant background jobs (e.g., nightly excise report generation, low-stock alert digest), or is everything synchronous request/response?

## 4. Frontend / UX

Implications: Web app (D-10) on a PC/laptop counter (D-9) with a "secure" requirement (D-11) and tablet support possibly later. There are at least three distinct surfaces implied: a fast-scan checkout screen (cashier), a stock-receiving screen (receiver), and an admin/reporting dashboard (owner). Not applicable is not an option here per the rubric's own warning — flagging screens explicitly.

Open questions:
- Q4.1 What does the cashier's checkout screen need to feel like — is speed-of-scan (no mouse, keyboard-wedge scanner input, audible beep/confirmation) the top UX priority given 2000 invoices/day?
- Q4.2 What does the receiver's "register a lot" screen need — bulk entry of many SKUs in one receiving session, or one-at-a-time scan-and-confirm like checkout?
- Q4.3 What does the owner's dashboard need on day one — EOD totals only, or also historical trends, low-stock list, credit/dues outstanding list?
- Q4.4 Manual barcode entry fallback (D-7): is this a plain text field, or does it need product search/autocomplete by brand name when the code is unknown?
- Q4.5 Any branding/labeling requirement — should the invoice/receipt be printable (thermal printer) or is on-screen/digital-only acceptable for v1?

## 5. Data and persistence

Implications: Multi-shop-ready schema (D-3), offline-first (D-8), and audit-trail requirement (invoice must retain scanned items/brand/prices verbatim, from intake) all push toward an explicit shop_id-scoped, append-heavy schema with careful migration planning from day one, per the ledger's own open thread.

Open questions:
- Q5.1 What database engine — and does the offline-first answer (Q3.1) force a specific choice (e.g., SQLite locally + Postgres centrally, vs. one Postgres reachable with retry/queue)?
- Q5.2 Retention: how long must invoice/lot history be kept? (Excise compliance in India may impose a specific legal retention period — needs research, not assumption.)
- Q5.3 Since invoice line items must be immutable once finalized (Q2.3), how are corrections handled at the data level — a correcting adjustment entry, or edit-in-place with an audit log?
- Q5.4 Multi-shop schema: is shop_id a column on every table from day one (per the ledger's open thread), even though only one shop exists at launch?

## 6. Auth, security, privacy

Implications: "Secure frontend" is explicitly named (D-11) but not defined. Four distinct roles (D-13) need an authorization model. This handles money (cash/UPI/credit) and a regulated product category, so access control and tamper-evidence on financial records matter more than in a typical CRUD app.

Open questions:
- Q6.1 What does "secure frontend" concretely mean to you — HTTPS + auth tokens is baseline, but is there a specific threat you're guarding against (e.g., a cashier editing past invoices to hide a till shortage)?
- Q6.2 Authorization model: simple role-based (4 fixed roles) or finer-grained permissions per shop?
- Q6.3 Any PII to protect — customer names/phone numbers for credit sales (Q2.2), or purely anonymous transactions?
- Q6.4 Password/PIN policy for shared counter devices — session timeout, per-cashier login, or one shared shop login?
- Q6.5 Superadmin (dev team) access to a friend's real shop data — what's the boundary here (e.g., is direct DB access by devs acceptable, or does even superadmin go through an audited access path)?

## 7. External integrations

Implications: None mentioned explicitly in the wishlist beyond payment mode tracking (Cash/UPI/Credit are recorded, not processed — no payment gateway integration implied so far, this app just records which mode was used, it doesn't move money).

Open questions:
- Q7.1 Confirm: does UPI here just mean "record that payment mode = UPI" (reconciled manually against the owner's bank/UPI app statement), or does it need real UPI payment-gateway integration (generating a QR code, confirming payment via API)?
- Q7.2 Any SMS/WhatsApp notification need (e.g., low-stock alert to owner's phone, credit-due reminder to a customer)?
- Q7.3 Any accounting-software export need (e.g., Tally, which is common in Indian retail) for the owner's existing bookkeeping?

## 8. Observability

Implications: Every invoice already functions as an audit record (from original intake). At 2000 invoices/day across roles, knowing who did what and when matters for trust (a friend's real business) and for any future dispute (e.g., "who marked this invoice as paid-cash").

Open questions:
- Q8.1 Is a per-action audit log (who created/edited/voided what, timestamped) a v1 requirement given the trust stakes, or acceptable to add later?
- Q8.2 Does the owner need any operational alerting beyond low-stock (e.g., "cashier X hasn't closed out the day's cash drawer")?

## 9. Failure modes and recovery

Implications: Offline-first (D-8) is itself a failure-mode answer for connectivity, but doesn't cover other failures: barcode unreadable (D-7 already covers this with manual entry), scanner hardware failure, power outage mid-checkout, wrong item scanned.

Open questions:
- Q9.1 What happens to an in-progress cart if the counter PC crashes or loses power mid-checkout — must it be recoverable, or is that acceptable data loss for v1?
- Q9.2 Can a cashier remove/undo a wrongly-scanned item from the current cart before checkout? (Likely yes, but not yet stated.)
- Q9.3 Sync conflicts once offline-first reconnects (ledger's open thread) — is "last write wins," "central server is always truth," or something else the intended resolution rule?

## 10. Testing strategy

Implications: Standard TDD approach from Superpowers execution phase applies once slices are defined; nothing liquor-specific changes the testing approach itself, but the excise/GST compliance requirement (D-6) implies specific correctness tests (e.g., tax calculation, report format) that need real reference data from the friend's shop's state excise rules.

Open questions:
- Q10.1 Is there a specific state's excise report format available to test against (once the friend's shop's state is known, per ledger open thread), or must v1 ship compliance features without a concrete reference to validate against?

## 11. Performance and scale

Implications: 2000 invoices/day (D-4) at, say, a 12-hour operating day, is roughly 3 invoices/minute average, but real liquor-shop traffic is bursty (evenings, weekends, holidays) — peak load could be much higher than the average implies. Catalog size is unknown (D-5, deferred).

Open questions:
- Q11.1 What's the busiest expected moment (e.g., Friday evening, festival eve) in invoices/minute, to size the checkout path's latency budget?
- Q11.2 Does the offline-first requirement mean performance must hold even with zero connectivity (i.e., the counter PC/local instance must handle full 2000/day volume on its own, with sync being purely secondary)?

## 12. Deployment and operations

Implications: Web app, Python/uv backend, single shop now with N-shop future (D-3, D-9, D-10, D-11). Someone (the dev team = superadmin, per D-13) will operate this — implying a hosting/ops responsibility beyond just writing code.

Open questions:
- Q12.1 Who hosts/operates this in production — you (the dev), on what infrastructure, and who is on call if the friend's shop's system goes down mid-business-hours?
- Q12.2 Given offline-first (Q3.1), does the friend's shop run a local server/instance physically at the counter, or purely a browser client with local storage syncing to your cloud backend?
- Q12.3 Update/upgrade path — how do you ship a new version to a live shop without disrupting a business day?

## 13. Compliance and constraints

Implications: D-6 makes GST + excise compliance non-negotiable for v1. This is the domain most likely to blow up scope if under-researched — Indian liquor excise rules are state-specific (the friend's shop's state isn't yet known, per ledger open thread), and vary in stock-register format, minimum retention period, and reporting cadence.

Open questions:
- Q13.1 What state is the friend's shop in? (Blocks concretizing every excise-related requirement below.)
- Q13.2 Does that state require any government-portal integration/reporting (some Indian states have moved excise reporting online), or is a printable/exportable stock register sufficient?
- Q13.3 Age verification — is this purely a policy/training matter for the cashier, or does the system need to prompt/log an age check per sale?
- Q13.4 GST: is the shop GST-registered (GSTIN needed on invoices), or below the registration threshold?

## 14. Docs and onboarding

Implications: Beyond the dev team (superadmin), real non-technical users (owner, cashier, receiver at a friend's shop) must be able to use this without your hand-holding every day.

Open questions:
- Q14.1 Does v1 need in-app guidance/help text for non-technical shop staff, or will you (the dev) personally train the friend's staff in person?
- Q14.2 Any developer-facing onboarding needed beyond the Swagger/OpenAPI docs already implied by D-11 (e.g., a README/setup guide, since this may grow beyond a solo project)?

---

## Grilling order (dependency sequence for Phase 2)

1. **Core domain model** (domain 2) — everything else depends on nailing down entities/lifecycle first.
2. **Compliance and constraints** (domain 13) — the shop's state and GST status change requirements elsewhere; resolve early to avoid rework.
3. **Users and personas** (domain 1) — role boundaries needed before API/auth design.
4. **Backend / API surface** (domain 3) — especially the offline-first architecture question (Q3.1), which is load-bearing for data, deployment, and performance domains.
5. **Data and persistence** (domain 5) — depends on domain model + offline-first decision.
6. **Auth, security, privacy** (domain 6) — depends on roles (domain 1) being settled.
7. **Frontend / UX** (domain 4) — depends on domain model + roles being settled.
8. **Failure modes and recovery** (domain 9) — depends on offline-first + UX being settled.
9. **Performance and scale** (domain 11) — depends on offline-first decision + catalog/volume answers.
10. **External integrations** (domain 7) — mostly confirmatory (Q7.1), low dependency, quick to close.
11. **Observability** (domain 8) — depends on roles/audit needs being clear.
12. **Deployment and operations** (domain 12) — depends on offline-first + hosting answers.
13. **Testing strategy** (domain 10) — depends on compliance specifics being known.
14. **Docs and onboarding** (domain 14) — last, lowest dependency on everything else.
