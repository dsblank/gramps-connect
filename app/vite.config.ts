/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Workspace-linked @gramps-connect/gramps-date ships raw .ts with no
// "exports" map -- excluding it from Vite's dependency pre-bundler avoids
// stale-pre-bundle HMR issues when it changes (see PLAN.md's notes on this
// package's build-less setup).
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@gramps-connect/gramps-date"],
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/*.test.ts"],
  },
});
