# v2 / 00 — Intake (enhancement batch on top of frozen v1)

This is a new increment on the already-implemented Barstock system (v1 shipped: issues #12–#19 in git history — checkout resilience, stock receiving, product catalog/bulk import, void approval, owner dashboard/EOD, staff management, multi-shop). This intake covers a new small batch of enhancement requests layered on that live system, not a greenfield rebuild. `harness/00-intake.md` through `harness/06-*` (v1) remain frozen and untouched; this v2 sub-pipeline gets its own artifacts under `harness/v2/`.

## Problem restatement

You want four additions to the existing check-in (stock receiving) and check-out (checkout/sale) flows:

1. When a product is checked in, the person doing the check-in ("checkin guy" = `receiver_user`) should get some kind of notification that "it's new — contact admin."
2. The same kind of notification should happen on the checkout side.
3. A way to handle a "damaged barcode" scenario during check-in/check-out.
4. A quick-search box at both check-in and check-out that accepts either the product code (barcode) or a typed product name, as a faster alternative to scanning.

## Unknowns — raw wording is ambiguous, needs your confirmation before I lock anything down

**Item 1 & 2 — "new, contact admin" notification**
- Who triggers this: does it fire when the receiver/cashier scans a barcode that **does not exist yet** in the product catalog (i.e., an unrecognized SKU)? Or does it fire every time a genuinely **new product is successfully created**, as an FYI to the admin/owner (not the receiver)?
- Given current roles (v1 D-25): `receiver_user` can only create Lots, not Products; `cashier_user` can only checkout. Neither role can create a Product today. So does this feature mean:
  - (a) receiver/cashier scans an unknown barcode → blocked, shown "Unknown product — contact admin to add it" (a guardrail message, no new capability), or
  - (b) you actually want receiver/cashier to be able to provisionally register a brand-new product on the spot, which then **notifies the owner/admin** to review/approve/finish setting it up (price, etc.)?
- "Notification" — in-app banner/badge only (matches v1's D-33 in-app-only pattern for low-stock alerts), or something more (persistent inbox/queue the admin checks)?
- Is this the same single notification type for both check-in and check-out, or two distinct ones?

**Item 3 — "damage barcode"**
- Two very different readings:
  - (a) The **barcode itself is physically unreadable/damaged** on the bottle — this is already handled in v1 (D-7: manual code-entry fallback when the scanner can't read it). If this is just "make sure manual entry is easy to find," it may already be done — I'd want to verify current UI, not treat it as new scope.
  - (b) The **product/bottle itself is damaged** (broken, leaking) and needs to be pulled from sellable stock — a new "mark as damaged" action during receiving (a lot arrives with some damaged units) and/or at checkout (a damaged item is found and shouldn't be sold), which would need to reduce stock and probably log a reason, separate from a normal sale or void.
- Which of these (or both) do you mean? If (b), does a "damaged" unit still count in the excise/stock-register audit trail (stockin_logs) as received-but-not-sellable, or does it just vanish from stock?

**Item 4 — quicksearch by code or name**
- This one reads clearly: at both the check-in (lot receiving) screen and the checkout screen, add a search/type-ahead input where staff can type either the barcode digits or a product name fragment to find and select a product, instead of only scanning. This seems like a straightforward UI addition compatible with existing v1 screens (R-24 checkout, R-25 receiving) — I don't see ambiguity here beyond confirming it's additive (scanning still works) and it doesn't replace the manual-barcode-entry fallback already in place.

## Decomposition of the raw wishlist

| Item from your description | Classification |
|---|---|
| Notification to check-in staff when a product is "new" | Feature — needs disambiguation (guardrail vs. provisional-create-and-notify-admin) |
| Notification on checkout side, same pattern | Feature — likely mirrors item 1's resolution |
| "Damage barcode" handling | Ambiguous — could be existing (unreadable barcode fallback, already shipped) or new (mark physical stock as damaged) |
| Quicksearch by code or name at check-in/checkout | Feature — UI/search addition to existing screens, low ambiguity |

---

**Is this your idea? Correct anything wrong — especially items 1/2 (which of the two readings) and item 3 (which of the two readings, or both).**

## Phase 0 confirmation — CLOSED

Confirmed 2026-07-07. Resolutions:
- Items 1/2 (notification): reading **(b)** — receiver/cashier CAN provisionally register a new product on the spot when they scan/enter an unrecognized barcode, but they only enter identifying info (e.g. brand name + size, "Bottle XYZ 750ml"). Price and "rest of settings" remain owner/admin's responsibility to fill in afterward. The notification (same mechanism for both check-in and checkout, following the existing v1 in-app pattern, D-33) tells the owner/admin a new product was added and needs completing.
- Item 3 (damage): reading **(a)** — this is the already-shipped unreadable-barcode manual-entry fallback (D-7). No new feature here; confirm existing UI surfaces it clearly at both screens.
- Item 4 (quicksearch): confirmed as described, no changes.

Open specifics deferred to Phase 1/2 grill: exact minimal fields captured at provisional creation; whether a priceless product can be sold at checkout before admin completes it; whether it's usable at check-in (stock lot) immediately; what "notify admin" means precisely (in-app banner vs. a persistent queue/list the owner reviews).

Proceeding to Phase 1 fan-out.
