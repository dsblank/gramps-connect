import { beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import type { TreeChangeNotification } from "../historyPoll";
import { TAG_VIEW } from "../views";

vi.mock("../api", () => ({
  fetchPage: vi.fn(),
  fetchByHandle: vi.fn(),
}));
vi.mock("../../auth/auth", () => ({
  getToken: vi.fn().mockResolvedValue("test-token"),
  // Read by cacheMeta.ts (imported by viewStore for its staleness check),
  // never exercised by these tests -- they all load via runQuery(persist:
  // false), which touches neither OPFS nor the meta table.
  getTreeId: vi.fn().mockReturnValue(null),
  getCurrentUsername: vi.fn().mockReturnValue(null),
}));

import { fetchByHandle, fetchPage } from "../api";
import { ViewStore } from "../viewStore";

// Shared across tests like registry.ts's own module-level cache -- wasm
// compilation is the slow part, no reason to redo it per test.
let sqlPromise: Promise<SqlJsStatic> | null = null;
function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) sqlPromise = initSqlJs();
  return sqlPromise;
}

function tagRow(handle: string, overrides: Partial<Record<string, unknown>> = {}) {
  return { handle, name: "Chores", color: "#ff0000", priority: 1, change: 1000, ...overrides };
}

function notification(handle: string, op: TreeChangeNotification["op"]): TreeChangeNotification {
  return { table: "tag", handle, op, changedBy: null };
}

/** Queues the next fetchPage() call's response for globalRankOfItem()'s
 * count-only query -- applyLiveChange() calls this once per INSERT/UPDATE
 * (after the existed/not-existed fetchByHandle already mocked separately)
 * to learn the row's authoritative server rank; `rank` becomes that
 * query's X-Total-Count. */
function mockRank(rank: number) {
  vi.mocked(fetchPage).mockResolvedValueOnce({ page: { items: [], next_after: null }, totalCount: rank });
}

/** A ViewStore whose local cache is already loaded via the normal
 * runQuery() path (persist: false, so OPFS never enters the picture) --
 * applyLiveChange() only patches an already-loaded cache, per its own
 * doc comment. */
async function loadedStore(seedItems: ReturnType<typeof tagRow>[]): Promise<ViewStore> {
  vi.mocked(fetchPage).mockResolvedValueOnce({
    page: { items: seedItems, next_after: null },
    totalCount: seedItems.length,
  });
  const store = new ViewStore(TAG_VIEW, getSql);
  await store.runQuery(null, false);
  return store;
}

describe("ViewStore.applyLiveChange", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  it("is a no-op when the view has no loaded cache yet", async () => {
    const store = new ViewStore(TAG_VIEW, getSql);
    const before = store.getSnapshot();

    await store.applyLiveChange(notification("H1", "UPDATE"));

    expect(store.getSnapshot()).toBe(before); // unchanged reference -> emit() never ran
    expect(fetchByHandle).not.toHaveBeenCalled();
  });

  it("DELETE removes an existing row and decrements loadedCount/totalCount", async () => {
    const store = await loadedStore([tagRow("H1")]);

    await store.applyLiveChange(notification("H1", "DELETE"));

    expect(store.getRows(0, 10)).toEqual([]);
    expect(store.getSnapshot().loadedCount).toBe(0);
    expect(store.getSnapshot().totalCount).toBe(0);
  });

  it("DELETE of a handle not in the cache is a no-op", async () => {
    const store = await loadedStore([tagRow("H1")]);
    const before = store.getSnapshot();

    await store.applyLiveChange(notification("does-not-exist", "DELETE"));

    expect(store.getSnapshot()).toBe(before);
  });

  it("UPDATE of an already-cached row refetches and upserts it in place, counts unchanged", async () => {
    const store = await loadedStore([tagRow("H1", { name: "Old" })]);
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H1", { name: "New" }));
    mockRank(0); // the only row -- nothing sorts before it

    await store.applyLiveChange(notification("H1", "UPDATE"));

    expect(fetchByHandle).toHaveBeenCalledWith(TAG_VIEW, "test-token", "H1");
    expect(store.getRows(0, 10)).toEqual([["New", "#ff0000", 1, 1000]]);
    expect(store.getSnapshot().loadedCount).toBe(1);
    expect(store.getSnapshot().totalCount).toBe(1);
  });

  it("UPDATE/INSERT of a handle not yet in the cache adds it and increments both counts", async () => {
    const store = await loadedStore([tagRow("H1")]);
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H2", { name: "Brand new" }));
    mockRank(1); // sorts after H1

    await store.applyLiveChange(notification("H2", "INSERT"));

    expect(store.getSnapshot().loadedCount).toBe(2);
    expect(store.getSnapshot().totalCount).toBe(2);
    expect(store.getRows(0, 10).map((row) => row[0])).toEqual(
      expect.arrayContaining(["Chores", "Brand new"])
    );
  });

  it("positions a genuinely new INSERT at its authoritative server rank, not appended at the end", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H0", { name: "Aardvark" }));
    mockRank(0); // sorts before both existing rows

    await store.applyLiveChange(notification("H0", "INSERT"));

    expect(store.getRows(0, 10).map((row) => row[0])).toEqual(["Aardvark", "Chores", "Chores"]);
    expect(store.getSnapshot().loadedCount).toBe(3);
    expect(store.getSnapshot().totalCount).toBe(3);
  });

  it("UPDATE/INSERT where the object was deleted again before the refetch lands is a no-op", async () => {
    const store = await loadedStore([tagRow("H1")]);
    vi.mocked(fetchByHandle).mockResolvedValueOnce(null);
    const before = store.getSnapshot();

    await store.applyLiveChange(notification("H2", "UPDATE"));

    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().loadedCount).toBe(1);
  });

  it("bumps revision on every applied change, for callers keying re-render off it alone", async () => {
    const store = await loadedStore([tagRow("H1")]);
    const revisionAfterLoad = store.getSnapshot().revision;
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H1", { color: "#00ff00" }));
    mockRank(0);

    await store.applyLiveChange(notification("H1", "UPDATE"));

    expect(store.getSnapshot().revision).toBe(revisionAfterLoad + 1);
  });

  it("bumps selectedRevision when the change matches the currently selected handle", async () => {
    const store = await loadedStore([tagRow("H1")]);
    store.select(0); // H1, the only row -- see getHandleAt()'s rowid ordering
    expect(store.getSnapshot().selectedHandle).toBe("H1");
    const selectedRevisionAfterSelect = store.getSnapshot().selectedRevision;
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H1", { color: "#00ff00" }));
    mockRank(0);

    await store.applyLiveChange(notification("H1", "UPDATE"));

    expect(store.getSnapshot().selectedRevision).toBe(selectedRevisionAfterSelect + 1);
  });

  it("leaves selectedRevision unchanged when the change is to a different, unselected row -- RelatedPanel must not refetch for it", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    store.select(0); // H1
    expect(store.getSnapshot().selectedHandle).toBe("H1");
    const selectedRevisionAfterSelect = store.getSnapshot().selectedRevision;
    const revisionAfterSelect = store.getSnapshot().revision;
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H2", { color: "#00ff00" }));
    mockRank(1); // H2 stays after H1

    await store.applyLiveChange(notification("H2", "UPDATE"));

    // The table-wide revision still bumps (DataTable needs to re-render H2's row) ...
    expect(store.getSnapshot().revision).toBe(revisionAfterSelect + 1);
    // ... but selectedRevision, which only H1's own detail panel watches, must not.
    expect(store.getSnapshot().selectedRevision).toBe(selectedRevisionAfterSelect);
  });

  it("UPDATE of an already-cached row repositions it to its authoritative server rank, not left in its old spot or appended at the end", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3")]);
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H1", { name: "ZZTop" }));
    mockRank(2); // H1's new value now sorts after both H2 and H3

    await store.applyLiveChange(notification("H1", "UPDATE"));

    // Old INSERT-OR-REPLACE behavior would've coincidentally landed here
    // too (new rowid = end of table), but only because a 3-row table has
    // nowhere else for "rank 2" to be -- the rank -> position mapping is
    // what's actually under test, not this particular table size.
    expect(store.getRows(0, 10).map((row) => row[0])).toEqual(["Chores", "Chores", "ZZTop"]);
  });

  it("moves an edited row anywhere in local order per its rank, not just to the end", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3")]);
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H3", { name: "Aardvark" }));
    mockRank(0); // H3's new value now sorts before both H1 and H2

    await store.applyLiveChange(notification("H3", "UPDATE"));

    expect(store.getRows(0, 10).map((row) => row[0])).toEqual(["Aardvark", "Chores", "Chores"]);
  });

  it("keeps selectedIndex pointed at the selected row even as a live UPDATE repositions it elsewhere", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3")]);
    store.select(0); // H1
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H1", { name: "ZZTop" }));
    mockRank(2); // H1 now sorts after H2 and H3

    await store.applyLiveChange(notification("H1", "UPDATE"));

    // Before this fix (index-based, not reconciled), the highlight would
    // have silently landed on whichever row ended up at the stale index 0
    // instead of following H1 to where it actually moved.
    expect(store.getSnapshot().selectedHandle).toBe("H1");
    expect(store.getSnapshot().selectedIndex).toBe(2);
  });

  it("reconciles selectedIndex when an earlier, unselected row is deleted -- every later row shifts up by one", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3")]);
    store.select(1); // H2
    expect(store.getSnapshot().selectedHandle).toBe("H2");

    await store.applyLiveChange(notification("H1", "DELETE"));

    // H2 is still the selection, but it's now the first row, not the second.
    expect(store.getSnapshot().selectedHandle).toBe("H2");
    expect(store.getSnapshot().selectedIndex).toBe(0);
  });

  it("clears the selection entirely when the selected row itself is live-deleted", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    store.select(0); // H1

    await store.applyLiveChange(notification("H1", "DELETE"));

    expect(store.getSnapshot().selectedIndex).toBeNull();
    expect(store.getSnapshot().selectedHandle).toBeNull();
  });
});
