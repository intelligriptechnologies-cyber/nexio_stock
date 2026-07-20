import type { Config } from "tailwindcss";
import { tokens } from "./src/theme/tokens";

// Barstock design tokens from docs/frontend_initial/barstock_design.md.
// Single source of truth: src/theme/tokens.ts. This file reads them so
// tailwind utilities (`bg-accent`, `text-on-primary`, etc.) match the
// design system exactly.
//
// Tailwind's Config types expect mutable tuples; tokens.ts is a frozen
// object, so we cast through `unknown` here. The runtime shape is identical.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: tokens.colors as unknown as Config["theme"] extends { extend?: infer E }
        ? E extends { colors?: infer C }
          ? C
          : Record<string, string>
        : Record<string, string>,
      fontFamily: tokens.fontFamily as unknown as Record<string, string[]>,
      fontSize: tokens.fontSize as unknown as Record<string, [string, Record<string, string | number>]>,
      borderRadius: tokens.borderRadius as unknown as Record<string, string>,
      boxShadow: tokens.boxShadow as unknown as Record<string, string>,
      transitionDuration: tokens.transitionDuration as unknown as Record<string, string>,
      zIndex: tokens.zIndex as unknown as Record<string, string>,
      spacing: tokens.spacing as unknown as Record<string, string>,
      minHeight: {
        touchTarget: tokens.touchTarget.DEFAULT,
        "touchTarget-sm": tokens.touchTarget.sm,
        "touchTarget-nav": tokens.touchTarget.nav,
      },
      minWidth: {
        touchTarget: tokens.touchTarget.DEFAULT,
        "touchTarget-sm": tokens.touchTarget.sm,
        "touchTarget-nav": tokens.touchTarget.nav,
      },
    },
  },
  plugins: [],
} satisfies Config;
