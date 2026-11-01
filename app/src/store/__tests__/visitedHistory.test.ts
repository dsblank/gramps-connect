import { beforeEach, describe, expect, it, vi } from "vitest";

// Plain Map-backed localStorage, as in columnWidths.test.ts (this suite
// runs in the "node" environment).
class FakeLocalStorage {
  store = new Map<string, string>();
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}
const storage = new FakeLocalStorage();
vi.stubGlobal("localStorage", storage);

const auth = { tree: "tree-1" as string | null, user: "alice" as string | null };
vi.mock("../../auth/auth", () => ({
  getTreeId: () => auth.tree,
  getCurrentUsername: () => auth.user,
}));

const {
  clearVisits, forgetVisits, getVisits, getVisitsVersion, isVisitable, MAX_VISITS, recordVisit, subscribeVisits,
} = await import("../visitedHistory");

describe("visitedHistory", () => {
  beforeEach(() => {
    storage.clear();
    auth.tree = "tree-1";
    auth.user = "alice";
  });

  it("lists visits newest first", () => {
    recordVisit("person", "A", 100);
    recordVisit("place", "B", 200);
    expect(getVisits()).toEqual([
      { type: "place", handle: "B", at: 200 },
      { type: "person", handle: "A", at: 100 },
    ]);
  });

  it("moves a revisit to the top instead of listing it twice", () => {
    recordVisit("person", "A", 100);
    recordVisit("place", "B", 200);
    recordVisit("person", "A", 300);
    expect(getVisits().map((v) => [v.handle, v.at])).toEqual([["A", 300], ["B", 200]]);
  });

  it("keeps the same handle under two types apart", () => {
    recordVisit("person", "X", 100);
    recordVisit("note", "X", 200);
    expect(getVisits()).toHaveLength(2);
  });

  it("ignores non-record views", () => {
    expect(isVisitable("story")).toBe(false);
    recordVisit("story", "S", 100);
    recordVisit("topics", "T", 100);
    expect(getVisits()).toEqual([]);
  });

  it("caps the list", () => {
    for (let i = 0; i < MAX_VISITS + 5; i++) recordVisit("person", `H${i}`, i);
    const visits = getVisits();
    expect(visits).toHaveLength(MAX_VISITS);
    expect(visits[0].handle).toBe(`H${MAX_VISITS + 4}`);
  });

  it("keeps a separate list per tree and per user", () => {
    recordVisit("person", "A", 100);
    auth.user = "bob";
    expect(getVisits()).toEqual([]);
    recordVisit("person", "B", 100);
    auth.tree = "tree-2";
    auth.user = "alice";
    expect(getVisits()).toEqual([]);
    auth.tree = "tree-1";
    expect(getVisits().map((v) => v.handle)).toEqual(["A"]);
  });

  it("forgets records that are gone, and clears only this list", () => {
    recordVisit("person", "A", 100);
    recordVisit("person", "B", 200);
    forgetVisits([{ type: "person", handle: "A" }]);
    expect(getVisits().map((v) => v.handle)).toEqual(["B"]);
    auth.user = "bob";
    recordVisit("person", "C", 100);
    auth.user = "alice";
    clearVisits();
    expect(getVisits()).toEqual([]);
    auth.user = "bob";
    expect(getVisits().map((v) => v.handle)).toEqual(["C"]);
  });

  it("survives corrupt storage", () => {
    storage.setItem("gramps-connect_visited", "{not json");
    expect(getVisits()).toEqual([]);
    storage.setItem("gramps-connect_visited", JSON.stringify({ "tree-1:alice": [{ type: "person" }, 5, null] }));
    expect(getVisits()).toEqual([]);
    recordVisit("person", "A", 100);
    expect(getVisits()).toHaveLength(1);
  });

  it("notifies subscribers on every change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVisits(listener);
    const before = getVisitsVersion();
    recordVisit("person", "A", 100);
    clearVisits();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getVisitsVersion()).toBe(before + 2);
    unsubscribe();
  });
});
