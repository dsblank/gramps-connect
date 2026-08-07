import { beforeEach, describe, expect, it, vi } from "vitest";
import { getColumnWidths, setColumnWidths } from "../columnWidths";

// vite.config.ts's test environment is "node", not jsdom, so there's no
// real localStorage global here -- stand in with a plain Map-backed one
// (the same shape every other test file in this project would need if it
// touched browser storage, not something specific to this test).
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

describe("columnWidths", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns undefined for a view with nothing saved yet", () => {
    expect(getColumnWidths("person")).toBeUndefined();
  });

  it("round-trips widths for a view", () => {
    setColumnWidths("person", { gramps_id: 100, surname: 220 });
    expect(getColumnWidths("person")).toEqual({ gramps_id: 100, surname: 220 });
  });

  it("keeps different views' widths independent", () => {
    setColumnWidths("person", { gramps_id: 100 });
    setColumnWidths("family", { gramps_id: 200 });
    expect(getColumnWidths("person")).toEqual({ gramps_id: 100 });
    expect(getColumnWidths("family")).toEqual({ gramps_id: 200 });
  });

  it("overwrites a view's previous widths on re-save", () => {
    setColumnWidths("person", { gramps_id: 100 });
    setColumnWidths("person", { gramps_id: 150 });
    expect(getColumnWidths("person")).toEqual({ gramps_id: 150 });
  });
});
