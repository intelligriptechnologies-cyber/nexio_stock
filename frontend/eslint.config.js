import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

// Globals used across the browser DOM, plus Node for vite.config.ts and
// Playwright files. ESLint flat config doesn't auto-pick these up; we
// declare them so the no-undef rule doesn't trip on `window`, `fetch`,
// `process`, `JSX`, etc.
const browserGlobals = {
  window: "readonly",
  document: "readonly",
  fetch: "readonly",
  sessionStorage: "readonly",
  localStorage: "readonly",
  console: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  Response: "readonly",
  Request: "readonly",
  Headers: "readonly",
  FormData: "readonly",
  Blob: "readonly",
  File: "readonly",
  FileReader: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  crypto: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  queueMicrotask: "readonly",
  navigator: "readonly",
  location: "readonly",
  history: "readonly",
  RequestInit: "readonly",
  RequestInfo: "readonly",
  BodyInit: "readonly",
  ReadableStream: "readonly",
  ReadableStreamDefaultReader: "readonly",
  ReadableStreamReadResult: "readonly",
  HTMLElement: "readonly",
  HTMLDivElement: "readonly",
  HTMLButtonElement: "readonly",
  HTMLInputElement: "readonly",
  HTMLFormElement: "readonly",
  Event: "readonly",
  KeyboardEvent: "readonly",
  MouseEvent: "readonly",
  MessageEvent: "readonly",
  JSX: "readonly",
  React: "readonly",
  JSXElementConstructor: "readonly",
  JSXElement: "readonly",
  atob: "readonly",
  btoa: "readonly",
  structuredClone: "readonly",
  alert: "readonly",
  confirm: "readonly",
};

const nodeGlobals = {
  process: "readonly",
  Buffer: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  global: "readonly",
  module: "readonly",
  require: "readonly",
  exports: "readonly",
};

export default [
  { ignores: ["dist", "node_modules", "playwright-report", "test-results", "src/api/schema.ts"] },
  {
    rules: {
      "no-undef": "off", // TypeScript handles this better
      "no-unused-vars": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: browserGlobals,
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-namespace": "off",
    },
  },
  {
    files: ["vite.config.ts", "tailwind.config.ts", "playwright.config.ts", "e2e/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
      globals: { ...browserGlobals, ...nodeGlobals },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];