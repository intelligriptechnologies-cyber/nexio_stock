# 04 — Absence Hunt

Single autonomous pass answering: "What was never discussed?" against the frozen PRD (`03-prd.md`) and ledger (`02-ledger.md`). No ledger entry is reopened here — only genuinely new gaps are surfaced.

## Findings

1. **Split/partial payment on one invoice** (e.g. part cash, part UPI) — every payment decision (D-15, D-40, R-33) assumes one mode per invoice. Real retail sometimes splits a large bill. Never discussed. → **Question.**
2. **Partial return/exchange of individual items** — D-18/D-37/R-8 model void as whole-invoice-in-or-out (direct void pre-signoff, compensating entry post-signoff). A customer returning 1 of 3 bottles was never addressed. → **Question.**
3. **Bulk initial product catalog import** — D-5 assumes hundreds to low-thousands of SKUs, but every product-creation path discussed (R-7, R-10, R-27) is one-at-a-time (assign barcode, scan/type). Populating an entire liquor shop's catalog one product at a time before day one is a real onboarding burden never addressed. → **Question.**
4. **Printed customer receipt** — Q4.5 was raised in the branch map (`01-branch-map.md`) but never actually put to the user during grilling; it fell through. R-24's checkout screen doesn't mention output. → **Question.**
5. **EOD sign-off scope with multiple counters** — D-39 established 2-3 concurrent counters; D-32/D-36 established manual EOD sign-off locking the day into `confirmed_sales`. Never resolved: is EOD one sign-off for the whole shop (requiring all counters to finish first), or can/must each counter close independently? This directly affects the two-tier storage design's granularity. → **Question.**
6. Cost/purchase price per lot and profit/margin reporting — only sale price was ever discussed (R-7); "competitively good" (D-12) commercial products typically show margin, but nothing forces this into v1. → **Deferred, default: not tracked in v1 — Lot records received quantity only, no cost price field. Revisit if profit reporting is wanted later.**
7. Discounts and cash rounding on an invoice — never mentioned. → **Deferred, default: no discount field, no rounding logic in v1 — invoice total is the exact sum of scanned line items at listed price.**
8. Duplicate/colliding barcodes across products — never addressed (what if two products end up assigned the same code by mistake). → **Deferred, default: barcode is a unique constraint at the database level; attempting to save a second product with an existing barcode is rejected with an error at product-creation time.**
9. Password reset / forgot-password flow — never discussed. → **Deferred, default: owner (who created the account, D-27) can reset a receiver/cashier's PIN from their own dashboard; superadmin can reset an owner's password. No self-service email reset in v1 (no email requirement was ever established for staff accounts).**
10. Database backup/disaster recovery beyond "retain indefinitely" (D-36) — retention says data isn't deleted, but says nothing about backup cadence if Supabase/Railway itself has an incident. → **Deferred, default: rely on the hosting platform's (Supabase/Railway) built-in backup features at whatever tier is provisioned; no separate custom backup pipeline in v1.**
11. Day boundary definition for EOD if a shop operates across midnight — never discussed. → **Deferred, default: a "day" is a calendar day in the shop's local timezone (IST); a shop trading past midnight would sign off covering only up to sign-off time, next day starts fresh at next sign-off. Revisit only if the friend's shop actually trades that late.**
12. Concurrent session/device management (same staff account logged in twice) — never discussed. → **Deferred, default: no restriction in v1 — a login can be active on multiple devices simultaneously; not a realistic risk at this shop's scale.**
13. Historical/trend reporting beyond a single day (weekly/monthly, brand-wise analytics) — D-12's "competitively good" bar gestures at this but R-26 only specifies EOD totals. → **Deferred, default: v1 dashboard shows per-day totals only (queryable by date since data is retained indefinitely per D-36/R-19); multi-day trend views/charts are a named v1.1 candidate, not built now.**
14. Provisioning process for shop #2 when it's actually added — D-3/D-35/R-17 make the schema ready, but who does the admin work (superadmin manually, or a self-service "add shop" flow) was never discussed. → **Deferred, default: superadmin manually provisions a new shop row and its first owner account directly (no self-service shop-signup UI in v1) — consistent with D-45's informal, dev-operated model at this scale.**

## Disposition

Findings 1-5 went to the user as questions; resolutions logged as D-59 through D-63. Findings 6-14 logged as deferred ledger entries D-50 through D-58. All folded into `03-prd.md` (R-40 through R-44, plus the expanded Deferred Items table) and the PRD re-frozen.

**Status: CLOSED.** All findings resolved. Proceeding to Phase 5 (slice).
