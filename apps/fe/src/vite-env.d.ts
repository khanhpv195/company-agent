/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** "1" serves the API from the in-app mock (src/mocks). */
  readonly VITE_MOCK?: string;
  /** Public terms / privacy pages linked from the register form; links are hidden when empty. */
  readonly VITE_TERMS_URL?: string;
  readonly VITE_PRIVACY_URL?: string;
  readonly VITE_SALES_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** App version from package.json, injected by vite `define`. */
declare const __APP_VERSION__: string;
