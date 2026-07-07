---
name: High-Efficiency Retail POS
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45474c'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#75777d'
  outline-variant: '#c5c6cd'
  surface-tint: '#545f73'
  primary: '#091426'
  on-primary: '#ffffff'
  primary-container: '#1e293b'
  on-primary-container: '#8590a6'
  inverse-primary: '#bcc7de'
  secondary: '#9d4300'
  on-secondary: '#ffffff'
  secondary-container: '#fd761a'
  on-secondary-container: '#5c2400'
  tertiary: '#001905'
  on-tertiary: '#ffffff'
  tertiary-container: '#003010'
  on-tertiary-container: '#1aa54c'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d8e3fb'
  primary-fixed-dim: '#bcc7de'
  on-primary-fixed: '#111c2d'
  on-primary-fixed-variant: '#3c475a'
  secondary-fixed: '#ffdbca'
  secondary-fixed-dim: '#ffb690'
  on-secondary-fixed: '#341100'
  on-secondary-fixed-variant: '#783200'
  tertiary-fixed: '#7ffc97'
  tertiary-fixed-dim: '#62df7d'
  on-tertiary-fixed: '#002109'
  on-tertiary-fixed-variant: '#005320'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 30px
  body-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  label-xl:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 24px
  label-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  touch-target-min: 64px
  gutter: 1.5rem
  margin-mobile: 1rem
  margin-desktop: 2.5rem
  stack-gap: 1rem
  section-gap: 2rem
---

## Brand & Style
The design system is engineered for **Barstock**, a high-volume liquor retail and inventory management platform tailored for the Odisha market. The primary objective is to bridge the gap for users with low computer literacy through a **High-Contrast / Utility-Focused** aesthetic. 

The style prioritizes clarity over decoration, using a "functional-first" approach that mimics physical retail hardware interfaces. It leverages bold color blocking, immense touch targets, and a strictly linear information architecture to minimize cognitive load. Every interaction is designed to feel authoritative, reliable, and indestructible in a fast-paced retail environment.

## Colors
The palette uses high-contrast semantics to guide the operator's eye toward critical actions and statuses. 

- **Primary (Deep Navy):** Used for structural elements like headers, sidebars, and primary text to provide a grounded, professional feel.
- **Accent (Safety Orange):** Reserved exclusively for the "Primary Action" on any screen (e.g., "Complete Sale", "Add Stock") to ensure the user never asks "What do I do next?".
- **Success (Green) & Danger (Red):** These are utilized in large blocks for state signaling. A successful payment should flood the summary area with green; a low-stock alert should use aggressive red.
- **Background (Light Gray):** Provides a soft contrast against the **White** surfaces to define "tappable" card areas clearly.

## Typography
Typography is oversized to ensure legibility under harsh retail lighting and for users with varying visual acuity. **Inter** is used across all levels for its exceptional readability and neutral, functional tone.

- **Scale:** The base body size starts at 18px, significantly higher than standard web apps.
- **Emphasis:** Critical data like "Total Amount" or "Change Due" must use the **Display-LG** or **Headline-LG** tokens.
- **Labels:** Button labels and status tags use **Label-XL** with heavy weights to remain legible at a glance from a distance.

## Layout & Spacing
This design system utilizes a **Fixed-Fluid Hybrid Grid**. Content is housed in a centered container on ultra-wide screens but stretches to fill mobile and tablet viewports.

- **Touch Targets:** A strict minimum height of **64px** is enforced for all interactive elements to accommodate "fat-finger" errors and rapid input.
- **Mobile/Tablet (Operators):** Uses a bottom-anchored navigation bar for easy thumb access. Workflows are presented in a 1-column linear stack.
- **Desktop (Admin):** Uses a persistent 280px left-hand sidebar for navigation between Inventory, Reports, and User Management.
- **The "Safety Margin":** Generous 24px (1.5rem) gutters prevent accidental taps on adjacent elements.

## Elevation & Depth
To keep the interface understandable for low-literacy users, this system avoids complex "glass" or "blur" effects. Depth is conveyed through **Tonal Layering** and **High-Contrast Outlines**.

- **Level 0 (Background):** The Light Gray (#F8FAFC) base.
- **Level 1 (Cards/Surfaces):** Pure White (#FFFFFF) with a subtle 1px border (#E2E8F0). No shadows are used on static cards to keep the UI "flat" and readable.
- **Level 2 (Interactive/Modals):** Elements that are currently being interacted with (like a PIN pad or a focused input) receive a 2px Safety Orange border and a medium-diffused shadow to indicate they are "active" and "on top."

## Shapes
A **Rounded (0.5rem)** strategy is used to make the interface feel modern yet approachable. 

- **Standard Buttons & Inputs:** 0.5rem radius.
- **Product Cards:** 1rem (Large) radius to create a distinct visual container for bottle images.
- **PIN Pad Keys:** 0.5rem radius to maintain a structural, grid-like feel that suggests "calculator" or "ATM" familiarity.

## Components

### PIN Pad
A full-screen component used for login and price overrides. Buttons are 80px+ in height with massive **Headline-LG** numerals. The "Confirm" key is always Safety Orange.

### Scanned Item Row
A horizontal card used in the checkout list.
- **Left:** Large thumbnail of the liquor bottle.
- **Center:** Product name (Body-LG) and SKU (Label-MD).
- **Right:** Large "Quantity" stepper with +/- buttons at the minimum 64px touch target size.

### Stat Card
Used in the inventory dashboard. 
- Features a massive icon on the left (e.g., a Shield for "Security" or a Box for "Stock").
- The numeric value uses **Display-LG**.
- The card background changes to **Danger (Red)** if the stock is below the threshold.

### Buttons
- **Primary Action:** Safety Orange background, White text, 64px height, bold icon + text.
- **Secondary Action:** Deep Navy outline, Navy text.
- **Destructive Action:** Red background, White text.

### Inputs
All input fields must include a persistent label above the field. The active state uses a 3px Safety Orange border to ensure the user knows exactly where they are typing.