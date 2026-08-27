/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";

// Reported by Help > System Information (see src/vite-env.d.ts). Read
// through createRequire rather than an import so this stays the one place
// package.json is touched -- importing it from src/ would bundle the whole
// file, dependency list and all, into the client.
const { version } = createRequire(import.meta.url)("./package.json");

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  // Default worker output format ("iife") can't code-split -- pyodideWorker.ts
  // (PoC, see src/pyodidePoc/) imports "pyodide", whose loader dynamically
  // imports Node builtins that Vite splits into their own externalized
  // chunks, which only the "es" format supports emitting for a worker entry.
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: [
      // Workspace-linked @gramps-connect/gramps-date ships raw .ts with no
      // "exports" map -- excluding it from Vite's dependency pre-bundler
      // avoids stale-pre-bundle HMR issues when it changes (see PLAN.md's
      // notes on this package's build-less setup).
      "@gramps-connect/gramps-date",
      // maplibre-gl (the Map view) spawns a web worker to parse vector
      // tiles and GeoJSON, found at runtime via `new Worker(new URL(
      // `./${name}`, import.meta.url))` -- a template literal, which Vite's
      // static asset scanner can't see, so it never emits the worker file
      // and the map is left with no worker at all, dev server or
      // `vite build` alike (see the setWorkerUrl() call in MapCanvas.tsx,
      // which is the actual fix -- this exclude alone does not solve it).
      // Pre-bundled instead of excluded, this failed differently but just
      // as silently: Vite rewrote the worker entry into an ESM module and
      // served it as .vite/deps/maplibre-gl-worker.mjs, which the *classic*
      // worker maplibre-gl falls back to constructing can't parse, so it
      // dies on its first `import` with no error reaching the page. Either
      // way the symptom is a map that looks *almost* fine: raster basemap
      // tiles need no worker and draw normally, while everything that does
      // need one silently never loads -- the style's own vector layers (no
      // roads, borders or labels) and our places source alike, with
      // isSourceLoaded() stuck false and not one .pbf ever requested.
      "maplibre-gl",
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/*.test.ts"],
  },
});
