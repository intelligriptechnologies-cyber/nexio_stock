// Single source of truth for the Barstock design tokens.
// Mirrors `docs/frontend_initial/barstock_design.md`:
//   primary   #1e293b (Deep Slate)
//   accent    #fb923c (Safety Orange — primary actions)
//   secondary #10b981 (Emerald Green — success)
//   surface   #f8fafc (Light Gray — background)
// Touch targets: min 64px (oversized, per design spec).

const orange = "#fb923c";

export const tokens = {
  colors: {
    primary: "#1e293b",
    "on-primary": "#ffffff",
    "primary-container": "#334155",
    accent: orange,
    "on-accent": "#1e293b",
    secondary: "#10b981",
    "on-secondary": "#ffffff",
    surface: "#f8fafc",
    "surface-container": "#f1f5f9",
    "surface-container-high": "#e2e8f0",
    "on-surface": "#0f172a",
    "on-surface-variant": "#475569",
    outline: "#cbd5e1",
    error: "#dc2626",
    "on-error": "#ffffff",
    success: "#10b981",
    warning: orange,
  },
  fontFamily: {
    body: ["Inter", "system-ui", "sans-serif"],
    mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
  },
  fontSize: {
    "display-lg": ["48px", { lineHeight: "56px", fontWeight: "800" }],
    "headline-lg": ["32px", { lineHeight: "40px", fontWeight: "700" }],
    "headline-md": ["24px", { lineHeight: "32px", fontWeight: "600" }],
    "body-lg": ["20px", { lineHeight: "30px", fontWeight: "500" }],
    "body-md": ["18px", { lineHeight: "28px", fontWeight: "400" }],
    "label-xl": ["20px", { lineHeight: "24px", fontWeight: "700" }],
    "label-md": ["16px", { lineHeight: "20px", fontWeight: "600" }],
  },
  borderRadius: {
    sm: "0.25rem",
    DEFAULT: "0.5rem",
    md: "0.75rem",
    lg: "1rem",
    xl: "1.5rem",
    full: "9999px",
  },
  spacing: {
    gutter: "1.5rem",
    "stack-gap": "1rem",
    "margin-desktop": "2.5rem",
    "margin-mobile": "1rem",
    "section-gap": "2rem",
  },
  touchTarget: {
    DEFAULT: "64px",
    sm: "48px",
  },
};

export type Tokens = typeof tokens;
