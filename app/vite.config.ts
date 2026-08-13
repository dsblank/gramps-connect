/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: [
      // Workspace-linked @gramps-connect/gramps-date ships raw .ts with no
      // "exports" map -- excluding it from Vite's dependency pre-bundler
      // avoids stale-pre-bundle HMR issues when it changes (see PLAN.md's
      // notes on this package's build-less setup).
      "@gramps-connect/gramps-date",
      // maplibre-gl (the Map view) spawns a *classic* web worker to parse
      // vector tiles and GeoJSON. Pre-bundled, Vite rewrites that worker
      // entry into an ESM module and serves it as
      // .vite/deps/maplibre-gl-worker.mjs -- which a classic worker can't
      // parse, so it dies on its first `import` with no error reaching the
      // page. The symptom is a map that looks *almost* fine: raster
      // basemap tiles need no worker and draw normally, while everything
      // that does need one silently never loads -- the style's own vector
      // layers (no roads, borders or labels) and our places source alike,
      // with isSourceLoaded() stuck false and not one .pbf ever requested.
      // Dev-server only; `vite build` bundles the worker correctly either
      // way.
      "maplibre-gl",
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/*.test.ts"],
  },
});
