import { beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { TAG_VIEW } from "../views";

vi.mock("../api", () => ({
  fetchPage: vi.fn(),
  fetchByHandle: vi.fn(),
}));
vi.mock("../../auth/auth", () => ({
  getToken: vi.fn().mockResolvedValue("test-token"),
  getTreeId: vi.fn().mockReturnValue(null),
  getCurrentUsername: vi.fn().mockReturnValue(null),
}));

import { fetchByHandle, fetchPage } from "../api";
import { ViewStore } from "../viewStore";

let sqlPromise: Promise<SqlJsStatic> | null = null;
function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) sqlPromise = initSqlJs();
  return sqlPromise;
}

function tagRow(handle: string, priority: number) {
  return { handle, name: "Chores", color: "#ff0000", priority, change: 1000 };
}
const ALL = [tagRow("H1", 1), tagRow("H2", 2), tagRow("H3", 2)];

/** A fake server: list queries return the rows the filter expression
 * allows ("priority == 1" keeps only H1), count-only queries (limit 1)
 * answer the membership check with 1 and the rank query with 0. Order
 * of calls doesn't matter, so the test can interleave freely. */
function fakeServer() {
  vi.mocked(fetchPage).mockImplementation(async (_view, _token, _after, _wantCount, expr, _orderBy, limit) => {
    const e = expr ?? "";
    if (limit === 1) {
      return { page: { items: [], next_after: null }, totalCount: e.includes("handle ==") ? 1 : 0 };
    }
    const items = e.includes("priority == 1") ? ALL.filter((r) => r.priority === 1) : ALL;
    return { page: { items, next_after: null }, totalCount: items.length };
  });
}

/** fetchByHandle calls that wait until the test releases them -- the
 * server round trip clearPickerFilter() makes before its own query. */
function gatedFetchByHandle() {
  const pending: Array<() => void> = [];
  vi.mocked(fetchByHandle).mockImplementation(
    (_view, _token, handle) =>
      new Promise((resolve) => pending.push(() => resolve(ALL.find((r) => r.handle === handle) ?? null))),
  );
  return {
    count: () => pending.length,
    releaseAll: () => pending.splice(0).forEach((go) => go()),
  };
}

async function filteredStore(): Promise<ViewStore> {
  fakeServer();
  vi.mocked(fetchByHandle).mockImplementation(async (_v, _t, handle) => ALL.find((r) => r.handle === handle) ?? null);
  const store = new ViewStore(TAG_VIEW, getSql);
  await store.runQuery(null, false);
  await store.setPickerFilter("priority == 1");
  expect(store.getSnapshot().pickerExpr).toBe("priority == 1");
  expect(store.getSnapshot().totalCount).toBe(1);
  return store;
}

describe("ViewStore filter changes that overlap (one starts during another's round trip)", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  it("control: search submitted after the clear finishes sees the whole list", async () => {
    const store = await filteredStore();

    await store.clearPickerFilter();
    await store.applyWhereExpr("name == 'Chores'");

    expect(store.getSnapshot().pickerExpr).toBeNull();
    expect(store.getSnapshot().totalCount).toBe(3);
  });

  it("a search submitted while the Filters picker is being cleared still ends with the picker filter gone", async () => {
    const store = await filteredStore();
    const gate = gatedFetchByHandle();

    const clearing = store.clearPickerFilter(); // ListHeader's × (fire and forget)
    await vi.waitFor(() => expect(gate.count()).toBe(1));
    const searching = store.applyWhereExpr("name == 'Chores'"); // FilterBar's Enter, a moment later
    await vi.waitFor(() => expect(gate.count()).toBe(2));
    gate.releaseAll();
    await Promise.all([clearing, searching]);

    const snap = store.getSnapshot();
    expect(snap.pickerExpr).toBeNull();
    expect(snap.whereExpr).toBe("name == 'Chores'");
    expect(snap.totalCount).toBe(3);
  });

  it("a Filters rule applied while the search box is being cleared doesn't bring the search back", async () => {
    const store = await filteredStore();
    await store.clearPickerFilter();
    await store.applyWhereExpr("name == 'Chores'");
    expect(store.getSnapshot().whereExpr).toBe("name == 'Chores'");
    const gate = gatedFetchByHandle();

    const clearing = store.applyWhereExpr(null); // the search box's ×
    await vi.waitFor(() => expect(gate.count()).toBe(1));
    const picking = store.setPickerFilter("priority == 1"); // Apply in the Filters dialog
    await vi.waitFor(() => expect(gate.count()).toBe(2));
    gate.releaseAll();
    await Promise.all([clearing, picking]);

    const snap = store.getSnapshot();
    expect(snap.whereExpr).toBeNull();
    expect(snap.pickerExpr).toBe("priority == 1");
    expect(snap.totalCount).toBe(1);
  });

  it("a search cleared before its round trip finishes ends with no search", async () => {
    const store = await filteredStore();
    await store.clearPickerFilter();
    const gate = gatedFetchByHandle();

    const searching = store.applyWhereExpr("name == 'Chores'");
    await vi.waitFor(() => expect(gate.count()).toBe(1));
    const clearing = store.applyWhereExpr(null);
    await vi.waitFor(() => expect(gate.count()).toBe(2));
    gate.releaseAll();
    await Promise.all([searching, clearing]);

    const snap = store.getSnapshot();
    expect(snap.whereExpr).toBeNull();
    expect(snap.pickerExpr).toBeNull();
    expect(snap.totalCount).toBe(3);
  });
});
