# 00 — Intake

## Problem restatement

You want to build a single-counter liquor shop application that manages the full product lifecycle: **onboarding a product** (assign or generate a barcode, print a sticker), **selling a product** (scan items at checkout to build an invoice, accept payment by Cash or UPI/Bank, mark the invoice paid), and **reporting** (owner reviews daily sales count, total revenue, and a cash-vs-UPI/bank split for reconciliation). Every invoice keeps the list of items scanned, with brand name and price, as a permanent record.

There is no separate "punch in / punch out" employee-attendance concept described anywhere in the raw wishlist — that phrase in your original one-liner appears to be your own shorthand for "stock check-in" (adding new inventory) vs "stock check-out" (a sale reducing inventory), not staff time-tracking. I'm treating it that way below, but flagging it explicitly since it's a term you used but never defined.

## Unknowns

**Users**
- Who uses this app day to day — the owner only, or also counter staff? Is there more than one role (e.g., admin vs cashier)?
- Single shop/counter, or does the owner plan to run this across multiple outlets eventually?

**Scale**
- Roughly how many distinct products (SKUs/brands) does a typical liquor counter carry? (affects catalog design, barcode volume)
- Roughly how many invoices/transactions per day? (affects whether this needs to be a robust always-online system or can tolerate occasional offline use)

**Constraints**
- Does an Indian liquor retailer have excise/regulatory reporting obligations this system should support (e.g., excise stock registers, age verification, batch/case tracking)? Several competitor products (VasyERP, Kamiti, Romio) advertise "excise-compliant" reports as a headline feature — this may not be optional for a real liquor counter.
- Does GST invoicing apply (GST number, tax breakup on the invoice)?
- Hardware: is there a real barcode scanner + label/sticker printer already owned, or does that need to be selected/bought as part of this project?
- Connectivity: is the shop counter reliably online, or does the app need offline-first operation?

**Stack**
- Platform: web app, desktop, or mobile? Who is the target device — a PC at the counter, a phone/tablet, or a dedicated POS terminal?
- Any existing backend/hosting preference, or is this greenfield?

**Non-goals**
- Is this meant to compete with / replace the commercial products found below, or just to be a lightweight personal tool for one shop?
- Multi-user accounts, supplier/purchase-order management, low-stock alerts, staff permissions — in scope for v1 or later?

**Definition of done (v1)**
- What's the smallest version you'd consider "done" and usable at the counter tomorrow? (e.g., just barcode-in, barcode-out-to-invoice, and an end-of-day cash/UPI total — deferring GST/excise formatting, multi-user, purchase orders, etc.)

## Decomposition of the raw wishlist

| Item from your description | Classification |
|---|---|
| Assign barcode to a product (manual entry or auto-generate) with product details (brand, price, etc.) | Feature — Product onboarding |
| Generate barcode + printable sticker | Feature — Label printing (may need a barcode symbology + printer choice) |
| Scan barcode at checkout to build a running list of items | Feature — Checkout / cart |
| Checkout the cart into an invoice | Feature — Invoice creation (this is really "stock check-out" reducing inventory) |
| Mark payment received, with mode (Cash / UPI/Bank) | Feature — Payment recording (multiple-features-in-one: payment mode selection + payment status tracking) |
| Store each invoice's scanned items, brand, prices | Constraint — data retention/audit trail requirement on every invoice |
| End-of-day: sales count, revenue, cash vs UPI/bank split | Feature — Daily reconciliation report (distinct from invoice creation; it's an aggregation/reporting feature) |
| "Punch in / punch out" | Ambiguous — used loosely to mean stock in (product onboarding) vs stock out (sale). Not staff attendance. Needs your confirmation. |

## Existing market options (answering your "what's already out there" question)

**India-specific, liquor-focused:**
- **VasyERP** — Indian cloud POS/ERP for liquor stores; GST + excise-compliant invoicing, multi-counter billing. Paid plans from ~₹11,999. ([vasyerp.com](https://vasyerp.com/retail/liquor-store-software))
- **Kamiti WineShop** — India-focused billing software for wine/liquor shops: barcode scanning, stock management, excise-compliant reports, UPI payment support, daily closing. This is very close to your exact spec. ([kamiti.app](https://kamiti.app/solutions/wineshop-billing-software))
- **Romio Technologies Liquor Shop Billing Software** — counter billing, barcode scanning, purchase management, MIS reporting for Indian liquor retailers. ([romiotech.com](https://romiotech.com/liquor-shop-software/))

**Global, liquor-focused (US-centric, likely not GST/excise-aware for India):**
- **Bottle POS** — liquor-specific POS, from $59/month. ([bottlepos.com](https://bottlepos.com/))
- **WinePOS** — barcode scanning, real-time stock, supplier management. ([winepos.com](https://winepos.com/))
- **Lightspeed, Toast, Square for Retail, FTx POS, NRS** — general retail POS systems with liquor-store variants; several (Lightspeed, Toast) include a built-in barcode/label generator. ([lightspeedhq.com](https://www.lightspeedhq.com/pos/retail/liquor-point-of-sale/), [pos.toasttab.com](https://pos.toasttab.com/retail-pos/liquor-store), [squareup.com](https://squareup.com/us/en/retail/wine-and-liquor))

**Takeaway:** commercial products already cover this exact use case (barcode-based liquor billing with cash/UPI reconciliation), particularly Kamiti in the Indian market. If you proceed, this project is either (a) a personal/learning build tailored exactly to your own shop's workflow, or (b) intentionally cheaper/simpler than these paid products, or (c) has some differentiator not yet stated. Worth confirming which, since it affects how much you invest in features the commercial tools already solved (e.g., excise compliance).

---

**Is this your idea? Correct anything wrong.**

## Phase 0 confirmation — CLOSED

Confirmed 2026-07-06. Punch-in/punch-out interpretation (stock-in vs stock-out) confirmed correct. Detailed answers captured in `02-ledger.md` (D-1 through D-16). Proceeding to Phase 1 fan-out.
