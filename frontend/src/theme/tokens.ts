// Single source of truth for the Barstock design tokens.
// Mirrors `docs/frontend_initial/barstock_design.md`:
//   primary   #1e293b (Deep Slate)
//   accent    #fb923c (Safety Orange — primary actions)
//   secondary #10b981 (Emerald Green — success)
//   surface   #f8fafc (Light Gray — background)
// Touch targets: min 64px (oversized, per design spec).

const actionGreen = "var(--color-action)";
const onAction = "var(--color-on-action)";
const activeTab = "var(--color-active-tab)";
const onActiveTab = "var(--color-on-active-tab)";
const logoutOrange = "#fb923c";

export const tokens = {
  colors: {
    primary: "#1e293b",
    "on-primary": "#ffffff",
    "primary-container": "#334155",
    action: actionGreen,
    "on-action": onAction,
    "action-hover": "#16a34a",
    "action-muted": "#bbf7d0",
    "active-tab": activeTab,
    "on-active-tab": onActiveTab,
    accent: actionGreen,
    "on-accent": "#ffffff",
    logout: logoutOrange,
    "on-logout": "#1e293b",
    secondary: "#10b981",
    "on-secondary": "#ffffff",
    sidebar: "#e2e8f0",
    "on-sidebar": "#1e293b",
    "on-sidebar-muted": "var(--color-sidebar-menu-inactive-text)",
    "sidebar-active": actionGreen,
    "on-sidebar-active": "var(--color-sidebar-menu-active-text)",
    "sidebar-hover": "#cbd5e1",
    surface: "#f8fafc",
    "surface-container": "#f1f5f9",
    "surface-container-high": "#e2e8f0",
    "on-surface": "#0f172a",
    "on-surface-variant": "#475569",
    outline: "#cbd5e1",
    error: "#fee2e2",
    "on-error": "#7f1d1d",
    success: "#10b981",
    warning: "#f59e0b",
    "on-warning": "#1e293b",
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
    xl: "1rem",
    full: "9999px",
  },
  boxShadow: {
    sm: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
    DEFAULT: "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)",
    md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
    lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
  },
  transitionDuration: {
    fast: "150ms",
    normal: "200ms",
    slow: "300ms",
  },
  zIndex: {
    dropdown: "10",
    sticky: "20",
    "modal-backdrop": "30",
    modal: "40",
    toast: "50",
    tooltip: "60",
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
    nav: "48px",
  },
};

export type Tokens = typeof tokens;
