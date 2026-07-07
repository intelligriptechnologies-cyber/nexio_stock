/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend API origin (e.g. "http://127.0.0.1:8000"). Set at build/dev time. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
