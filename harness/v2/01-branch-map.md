# v2 / Branch Map

Confirmed problem (from `v2/00-intake.md`): add (1) provisional new-product registration + admin notification at check-in and check-out, when receiver/cashier scans an unrecognized barcode, capturing only minimal identifying info (name+size), leaving price/settings to owner/admin; (2) confirm existing damaged-barcode manual-entry fallback already covers the "damage" ask (no new build); (3) add a quicksearch-by-code-or-name input at both check-in and check-out screens.

No item is UNMAPPED — all three build-worthy asks map into the domains below.

## 1. Users and personas
Implications: No new roles. This extends what `receiver_user` and `cashier_user` (v1 R-2) can already do — today neither can create a Product at all; this adds a narrow, minimal-field product-creation capability to both, gated by "owner must complete it later."
Open questions:
- Q1.1 Does `receiver_user` get this capability, `cashier_user` get it, or both (user has confirmed "both, same notification" — closing this)?
- Q1.2 Should `owner` also see/use the same quicksearch and provisional-create UI, or is this receiver/cashier-only surface?

## 2. Core domain model
Implications: This is the most consequential domain for this batch. Today (v1 R-7) a `Product` is fully specified (barcode, price, stock) before it can be received or sold. This feature introduces a **partial/incomplete Product state** — a lifecycle addition: `pending` (name+size only, no price) → `complete` (owner fills price/threshold/etc.) → normal Product. Need to decide how this interacts with existing invariants (R-9: every invoice line resolves to a real, in-stock product at scan time).
Open questions:
- Q2.1 What are the exact minimal fields captured at provisional creation? User said "brand name + size" (e.g. "Bottle XYZ 750ml") — is barcode itself always known (it was scanned) and just unmapped to a Product yet, or can this also cover manual barcode entry for the new item?
- Q2.2 Can a `pending` product be received into a Lot (stock quantity incremented) before it has a price? (Receiving doesn't need price today, so this seems fine — but confirm.)
- Q2.3 Can a `pending` product be **sold** at checkout before owner sets its price? If yes, at what price (zero? blocked?) — this conflicts with the "price with owner/admin" resolution unless checkout for pending products is blocked until completed.
- Q2.4 Once owner completes a pending product (sets price+settings), does it just become a normal Product transparently, or is there an explicit "activate" step?
- Q2.5 Can the *same* barcode be provisionally created twice (racing receiver and cashier both hitting the same unknown code around the same time)? Needs the same duplicate-barcode uniqueness handling as v1 D-52.

## 3. Backend / API surface
Implications: New endpoint(s) needed: create-provisional-product (from receiving screen and/or checkout screen), list-pending-products (for owner to complete), complete-pending-product (owner fills remaining fields), and a notification-fetch/ack endpoint. Quicksearch needs a lookup-by-name-or-code endpoint against the locally-cached catalog (v1 D-30 already caches catalog client-side, so this may be a pure frontend filter, not a new API call).
Open questions:
- Q3.1 Is quicksearch a client-side filter over the already-cached catalog (D-30), or does it need a new backend search endpoint (matters if catalog gets large or search needs to be fuzzy/server-side)?
- Q3.2 Is provisional-product creation idempotent per barcode (same pattern as checkout's idempotency key, D-30), so a double-submit doesn't create two pending rows for one barcode?

## 4. Frontend / UX
Implications: Quicksearch is a straightforward addition to the existing checkout (R-24) and receiving (R-25) screens — an input box above/alongside the scan field, filtering as you type, tapped to select (fits v1's low-literacy UX constraint, R-23/D-38). The provisional-create flow needs a minimal "quick add" form (2 fields: name, size) triggered when a scan/search finds nothing, plus an owner-side "pending products" screen/list to complete them. Notification needs a visible surface (banner/badge) for the owner, following the existing low-stock-alert pattern (D-33/R-26).
Open questions:
- Q4.1 Where does the owner see/action the "new pending product" notification — a badge on the existing owner dashboard (R-26), a dedicated "Pending Products" screen, or both?
- Q4.2 Does the receiver/cashier see any confirmation that their quick-add succeeded, beyond the item now appearing in their cart/lot (e.g., a toast "Added — pending owner review")?

## 5. Data and persistence
Implications: Needs either a new `status` column on `Product` (`pending`/`active`) or a separate `pending_products` staging table. A new lightweight notification/queue record is needed to track "owner hasn't acknowledged this yet" — could reuse v1's domain-log-table pattern (D-47: `invoicing_logs`/`stockin_logs`) or need a new `notifications` table.
Open questions:
- Q5.1 Status column on Product vs. separate staging table — which fits better given R-9's "every invoice line resolves to a real product" invariant (a `pending` Product is still "real" but incomplete)?
- Q5.2 Is the admin notification a queryable/dismissible record (a small `notifications` table: type, target, created_by, acknowledged_at), or purely a live computed count ("N products missing a price") with no persisted per-notification acknowledgment state?

## 6. Auth, security, privacy
Not applicable: no new identity/authz concepts — this reuses existing role boundaries (receiver/cashier/owner) from v1 (D-25, D-26). Only decision is authorization on the new endpoints (who can call create-provisional vs. complete-pending), which is a restatement of existing role scoping, not a new security question. (requires user confirmation)

## 7. External integrations
Not applicable: no third-party service involved — "notification" per user's answer follows the existing in-app-only pattern (D-33), no SMS/email/push gateway. (requires user confirmation)

## 8. Observability
Implications: Provisional-product creation and completion should be logged, most naturally as an extension of `stockin_logs` (if created during receiving) or a new small log entry type, consistent with v1's domain-specific log-table pattern (D-47) rather than a generic log.
Open questions:
- Q8.1 Does provisional-product creation get its own log table/field, or does it piggyback on existing `stockin_logs`/`invoicing_logs` entries with a flag like `product_created: true`?

## 9. Failure modes and recovery
Implications: Key failure mode is Q2.3 above — a cashier scans a code, finds nothing, quick-adds it, but then can't finish the sale because there's no price yet. Need a defined behavior (block the line with a clear message vs. hold the cart) rather than letting it silently fail.
Open questions:
- Q9.1 If checkout hits a pending (priceless) product, what exactly happens to that cart/line — held, removed with a message, or the whole checkout blocked until price exists?

## 10. Testing strategy
Implications: Standard TDD per Superpowers phase once this reaches implementation; needs correctness tests for: pending-product creation not violating R-9 invariants, duplicate-barcode race handling (Q2.5), and the checkout-hits-pending-product path (Q9.1).
No open questions beyond what's already listed above (test scope follows from the domain-model decisions, not a separate branch).

## 11. Performance and scale
Not applicable: this is a low-frequency admin/edge-case flow (new SKUs don't arrive at anywhere near the 2000-invoices/day rate, D-4/D-39) and quicksearch is filtering an already-small, already-cached catalog (D-30) — no new performance-critical path introduced. (requires user confirmation)

## 12. Deployment and operations
Not applicable: no new infra, hosting, or ops process — ships as a normal code change to the existing Supabase/Railway-hosted app (D-8/D-45). (requires user confirmation)

## 13. Compliance and constraints
Implications: A `pending` product that gets received into stock (Q2.2) before it has a price still needs to appear correctly in the excise stock-register trail (v1 R-34/D-34's Lot-level tracking) — quantity received should count even if price isn't set yet.
Open questions:
- Q13.1 Does a pending product's received quantity count toward stock/audit reporting immediately, or only once "activated" by the owner?

## 14. Docs and onboarding
Not applicable: given v1's R-36 (UI-driven guidance, no written help text), this small addition doesn't need separate documentation beyond what the UI itself conveys; OpenAPI spec (R-11) picks up any new endpoints automatically. (requires user confirmation)

---

## Grilling order (dependency sequence for Phase 2)

1. **Core domain model** (Q2.1–Q2.5) — must resolve the pending-product lifecycle before anything else makes sense.
2. **Failure modes and recovery** (Q9.1) — directly depends on the domain-model answer (can't decide checkout behavior until we know if pending products can be sold).
3. **Data and persistence** (Q5.1–Q5.2) — schema shape follows from the lifecycle decision.
4. **Backend / API surface** (Q3.1–Q3.2) — endpoint shape follows from the schema.
5. **Frontend / UX** (Q4.1–Q4.2) — screen behavior follows from API + lifecycle.
6. **Observability** (Q8.1) — logging shape follows from where creation actually happens.
7. **Compliance and constraints** (Q13.1) — final check against the audit-trail requirement.
8. **Users and personas** (Q1.2) — quick confirmation, no dependency on the above.
