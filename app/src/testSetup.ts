// Vitest global test setup (vite.config.ts's test.setupFiles) -- runs for
// every test file regardless of environment, so anything DOM-specific here
// must be guarded: a plain *.test.ts (the vast majority of this suite) runs
// under Vitest's default "node" environment with no `window`/`document` at
// all; only a *.test.tsx opting into a leading `// @vitest-environment
// jsdom` comment (see vite.config.ts's own comment) gets one.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

if (typeof window !== "undefined") {
  // Without this, nothing unmounts a previous test's render between `it()`
  // blocks in the same file: @testing-library/react's own auto-cleanup
  // only self-registers when it finds a *global* `afterEach` (Vitest's
  // `test.globals` option, which this project deliberately leaves off --
  // every existing test explicitly imports `describe`/`it`/`vi` from
  // "vitest" rather than relying on injected globals, and this follows the
  // same convention). Confirmed live: without this, a second test's
  // `getByRole` query found the first test's still-mounted Modal too and
  // failed with "multiple elements found" -- later tests were silently
  // seeing earlier ones' leftover DOM, not just an untidiness.
  afterEach(cleanup);

  // jsdom implements neither of these -- Mantine's ScrollArea/Modal/
  // Tooltip/AppShell (used throughout this app's own components) all read
  // at least one, and throw synchronously on mount without a stub.
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }

  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }
}
