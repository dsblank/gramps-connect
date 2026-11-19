import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { clearActivity, getActivity, logActivity, MAX_ACTIVITY } = await import("../activityLog");

describe("activityLog", () => {
  beforeEach(() => {
    storage.clear();
    auth.tree = "tree-1";
    auth.user = "alice";
  });

  it("appends steps oldest first, with whole-second times", () => {
    logActivity({ kind: "route", viewKey: "person", handle: "H1" }, 100.7);
    logActivity({ kind: "searchAll", query: "Blank", type: null }, 200);
    expect(getActivity()).toEqual([
      { kind: "route", viewKey: "person", handle: "H1", at: 100 },
      { kind: "searchAll", query: "Blank", type: null, at: 200 },
    ]);
  });

  it("keeps revisits as separate steps, but not the same route twice in a row", () => {
    logActivity({ kind: "route", viewKey: "person", handle: "H1" }, 1);
    logActivity({ kind: "route", viewKey: "person", handle: "H1" }, 2);
    logActivity({ kind: "route", viewKey: "person", handle: "H2" }, 3);
    logActivity({ kind: "route", viewKey: "person", handle: "H1" }, 4);
    expect(getActivity().map((e) => e.at)).toEqual([1, 3, 4]);
  });

  it("tells a visual's subjects apart", () => {
    logActivity({ kind: "route", viewKey: "map", subject: { type: "person", handle: "A" } }, 1);
    logActivity({ kind: "route", viewKey: "map", subject: { type: "person", handle: "B" } }, 2);
    logActivity({ kind: "route", viewKey: "map" }, 3);
    expect(getActivity()).toHaveLength(3);
  });

  it("records away once, and never as the first step", () => {
    logActivity({ kind: "away" }, 1);
    logActivity({ kind: "route", viewKey: "person", handle: "H1" }, 2);
    logActivity({ kind: "away" }, 3);
    logActivity({ kind: "away" }, 4);
    expect(getActivity().map((e) => e.kind)).toEqual(["route", "away"]);
  });

  it("keeps each tree and user apart, and records nothing signed out", () => {
    logActivity({ kind: "gramplet", id: "g", name: "G" }, 1);
    auth.user = "bob";
    expect(getActivity()).toEqual([]);
    auth.user = null;
    logActivity({ kind: "gramplet", id: "g", name: "G" }, 2);
    auth.user = "alice";
    auth.tree = "tree-2";
    expect(getActivity()).toEqual([]);
    auth.tree = "tree-1";
    expect(getActivity()).toHaveLength(1);
  });

  it("drops the oldest past the cap", () => {
    for (let i = 0; i < MAX_ACTIVITY + 5; i++) logActivity({ kind: "searchAll", query: String(i), type: null }, i);
    const list = getActivity();
    expect(list).toHaveLength(MAX_ACTIVITY);
    expect(list[0].at).toBe(5);
  });

  it("clears only this tree and user", () => {
    logActivity({ kind: "gramplet", id: "g", name: "G" }, 1);
    auth.user = "bob";
    logActivity({ kind: "gramplet", id: "g", name: "G" }, 1);
    clearActivity();
    expect(getActivity()).toEqual([]);
    auth.user = "alice";
    expect(getActivity()).toHaveLength(1);
  });
});
