/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
