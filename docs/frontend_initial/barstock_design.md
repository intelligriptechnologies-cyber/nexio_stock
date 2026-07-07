# Barstock Design System & Specification

## 1. Brand Identity & Visual Language
The Barstock design system is built for high-stakes, high-volume retail environments where speed and accuracy are paramount. The visual language prioritizes **clarity**, **contrast**, and **accessibility** for users with varying levels of computer literacy.

### Color Palette
- **Primary:** `#1e293b` (Deep Slate) — Used for core structural elements, sidebars, and primary text to provide a stable, professional base.
- **Accent:** `#fb923c` (Safety Orange) — Reserved for primary actions (Checkout, Login, Save) to guide the eye immediately to the next step.
- **Secondary:** `#10b981` (Emerald Green) — Used for "Added" confirmations and success states.
- **Surface:** `#f8fafc` (Light Gray) — A clean, low-glare background for prolonged use.

### Typography
- **Font:** Inter (Sans-serif)
- **Hierarchy:** 
  - **Headlines:** Extra-bold and oversized for screen titles.
  - **Values:** Monospaced or heavy weights for currency and quantities to ensure no ambiguity.
  - **Labels:** Large, high-contrast text for low-literacy readability.

### Components & Patterns
- **Oversized Touch Targets:** All buttons are minimum 48px high, with primary actions often reaching 80px.
- **Visual Feedback:** Use of large icons and color-coded status banners (e.g., green "Added" badges) to confirm scan success.
- **Linear Flows:** One primary action per screen to prevent decision fatigue.

---

## 2. Screen Architecture

### 2.1 Login - PIN Pad
- **Purpose:** Secure, fast access for staff.
- **Design:** Centered numeric pad with large digits. Minimalist interface to reduce confusion.
- **Reference:** {{DATA:SCREEN:SCREEN_5}}

### 2.2 Checkout - Sales Counter
- **Purpose:** Rapid barcode-driven billing.
- **Design:** 
  - **Left Panel:** Running list of scanned items with brand, size, and quantity.
  - **Right Panel:** Order summary with large "TOTAL PAYABLE" value and one-tap payment mode selection (Cash, UPI, Card).
  - **Action:** Massive "FINISH & PAY" button.
- **Reference:** {{DATA:SCREEN:SCREEN_6}}

### 2.3 Stock Receiving - New Lot
- **Purpose:** Registering incoming inventory.
- **Design:** Simplified list of scanned products with heavy +/- controls for quantity adjustment. Large "SAVE STOCK" footer.
- **Reference:** {{DATA:SCREEN:SCREEN_4}}

### 2.4 Owner Dashboard & EOD
- **Purpose:** Managerial oversight and daily reconciliation.
- **Design:** 
  - **KPI Cards:** Total Revenue, Invoice Count, and Payment Split.
  - **Charts:** Sales volume by hour to track peak times.
  - **Alerts:** Critical section for Low Stock and Void Approval requests.
- **Reference:** {{DATA:SCREEN:SCREEN_2}}

---

## 3. Responsive Strategy
The system uses a **Fluid Sidebar** and **Stacked Column** approach:
- **Desktop:** Fixed sidebar for navigation with a broad content area.
- **Tablet:** Sidebar collapses into a drawer; content cards stack into 2 columns.
- **Mobile:** Single-column layout with a bottom navigation bar for core functions.
