/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** app/package.json's `version`, substituted at build time by vite.config.ts
 * -- what Help > System Information reports as this client's version. Not
 * read from package.json directly so the file itself (dependency list,
 * scripts) stays out of the shipped bundle. */
declare const __APP_VERSION__: string;
