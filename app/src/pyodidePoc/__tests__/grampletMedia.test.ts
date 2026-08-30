import { beforeEach, describe, expect, it, vi } from "vitest";

// vite.config.ts's test environment is "node", not jsdom -- stand in with
// a plain Map-backed localStorage, same as store/__tests__/columnWidths.test.ts.
class FakeLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  clear() {
    this.store.clear();
  }
}
vi.stubGlobal("localStorage", new FakeLocalStorage());

vi.mock("../../auth/auth", () => ({
  getToken: vi.fn(),
  hasPermissions: vi.fn(),
}));

import { hasPermissions } from "../../auth/auth";
import { canAuthorGramplets, effectiveAddedViews, GRAMPLET_AUTHOR_PERMISSION, writeLocalAddedViews } from "../grampletMedia";
import type { Gramplet } from "../types";

function gramplet(overrides: Partial<Gramplet> = {}): Gramplet {
  return { id: "g1", label: "Test", code: "", ...overrides };
}

describe("effectiveAddedViews", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("falls back to the manifest's own addedViews when this browser has no local preference", () => {
    expect(effectiveAddedViews(gramplet({ addedViews: ["person", "family"] }))).toEqual(["person", "family"]);
  });

  it("defaults to added-nowhere when neither a local preference nor a manifest value exists", () => {
    expect(effectiveAddedViews(gramplet())).toEqual([]);
  });

  // F9 (discussion #4): a Gramplet's "which views show it" used to be part
  // of the shared manifest -- one viewer's (+)/(-) toggle affected every
  // other viewer's tab layout. It's local-only now.
  it("prefers this browser's own local preference over the manifest's value", () => {
    writeLocalAddedViews("g1", ["event"]);
    expect(effectiveAddedViews(gramplet({ addedViews: ["person", "family"] }))).toEqual(["event"]);
  });

  it("an explicitly emptied local preference wins over a non-empty manifest value", () => {
    writeLocalAddedViews("g1", []);
    expect(effectiveAddedViews(gramplet({ addedViews: ["person"] }))).toEqual([]);
  });

  it("keeps different Gramplets' local preferences independent", () => {
    writeLocalAddedViews("g1", ["person"]);
    writeLocalAddedViews("g2", ["event"]);
    expect(effectiveAddedViews(gramplet({ id: "g1" }))).toEqual(["person"]);
    expect(effectiveAddedViews(gramplet({ id: "g2" }))).toEqual(["event"]);
  });
});

describe("canAuthorGramplets", () => {
  it("checks the higher-tier GRAMPLET_AUTHOR_PERMISSION, not plain EditObject", () => {
    vi.mocked(hasPermissions).mockReturnValue(true);
    expect(canAuthorGramplets()).toBe(true);
    expect(hasPermissions).toHaveBeenCalledWith(GRAMPLET_AUTHOR_PERMISSION);
  });

  it("is false when the viewer lacks it", () => {
    vi.mocked(hasPermissions).mockReturnValue(false);
    expect(canAuthorGramplets()).toBe(false);
  });
});
