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

describe("ViewStore default selection", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  it("selects the first row as soon as a query lands, so the detail panes are never empty", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);

    expect(store.getSnapshot().selectedHandle).toBe("H1");
    expect(store.getSnapshot().selectedIndex).toBe(0);
    expect(store.getSnapshot().selectionIsDefault).toBe(true);
  });

  it("leaves nothing selected when the query returns no rows at all", async () => {
    const store = await loadedStore([]);

    expect(store.getSnapshot().selectedHandle).toBeNull();
    expect(store.getSnapshot().selectionIsDefault).toBe(false);
  });

  it("stops flagging the selection as default once the user clicks that same row", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    expect(store.getSnapshot().selectionIsDefault).toBe(true);

    store.select(0); // the row that was already auto-selected

    // The handle didn't change, but this is now an explicit choice --
    // useHistorySync keys off exactly this flag to decide whether the
    // handle belongs in the URL.
    expect(store.getSnapshot().selectedHandle).toBe("H1");
    expect(store.getSnapshot().selectionIsDefault).toBe(false);
  });

  it("reverts to the default rather than to nothing when the selection is cleared", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    store.select(1); // H2

    store.clearSelection(); // history navigation to a handle-less "#/view" route

    expect(store.getSnapshot().selectedHandle).toBe("H1");
    expect(store.getSnapshot().selectionIsDefault).toBe(true);
  });

  it("does not re-emit when clearing a selection that is already the default", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    const before = store.getSnapshot();

    store.clearSelection();

    // Same snapshot object, not just an equal one -- Back onto a
    // handle-less route repeatedly must not churn subscribers.
    expect(store.getSnapshot()).toBe(before);
  });
});

describe("ViewStore.runQuery preserveDisplayUntilCaughtUp (requeryDebounced)", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  it("does not let loadedCount regress while a live-sync requery's first page is still smaller than what was already showing", async () => {
    // Already-scrolled view: 3 rows loaded across two pages.
    vi.mocked(fetchPage)
      .mockResolvedValueOnce({ page: { items: [tagRow("H1"), tagRow("H2")], next_after: "H2" }, totalCount: 3 })
      .mockResolvedValueOnce({ page: { items: [tagRow("H3")], next_after: null }, totalCount: 3 });
    const store = new ViewStore(TAG_VIEW, getSql);
    await store.runQuery(null, false);
    await vi.waitFor(() => expect(store.getSnapshot().loadedCount).toBe(3));

    // A live-sync requery whose own page one only comes back with 1 row,
    // with more still to fetch in the background.
    vi.mocked(fetchPage)
      .mockResolvedValueOnce({ page: { items: [tagRow("H1")], next_after: "H1" }, totalCount: 3 })
      .mockResolvedValueOnce({ page: { items: [tagRow("H2"), tagRow("H3")], next_after: null }, totalCount: 3 });

    await store.runQuery(null, false, { preserveDisplayUntilCaughtUp: true });

    // The bug this guards against: loadedCount briefly dropping to 1 (the
    // requery's own page-one size) before the background fill catches
    // back up -- DataTable would render rows 1-2 as "loading" placeholders
    // even though they were already showing a moment before.
    expect(store.getSnapshot().loadedCount).toBe(3);

    // The background fill still completes and the new data does land.
    await vi.waitFor(() => expect(store.getSnapshot().totalCount).toBe(3));
    expect(store.getSnapshot().loadedCount).toBe(3);
  });

  it("still shows the requery's first page immediately once it alone reaches the previous count", async () => {
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1"), tagRow("H2")], next_after: null },
      totalCount: 2,
    });
    const store = new ViewStore(TAG_VIEW, getSql);
    await store.runQuery(null, false);
    expect(store.getSnapshot().loadedCount).toBe(2);

    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1"), tagRow("H2"), tagRow("H3")], next_after: null },
      totalCount: 3,
    });
    await store.runQuery(null, false, { preserveDisplayUntilCaughtUp: true });

    // One page already covers (and exceeds) the old count -- no need to
    // wait for a background fill that isn't coming.
    expect(store.getSnapshot().loadedCount).toBe(3);
  });
});

describe("ViewStore.clearFilter", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  it("keeps the current selection pointed at the same record once the filter is dropped", async () => {
    const store = new ViewStore(TAG_VIEW, getSql);
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H2")], next_after: null },
      totalCount: 1,
    });
    await store.runQuery("name == 'Chores'", false);
    expect(store.getSnapshot().selectedHandle).toBe("H2"); // default selection under the filter

    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1"), tagRow("H2"), tagRow("H3")], next_after: null },
      totalCount: 3,
    });
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H2"));
    mockRank(1); // H1 sorts before H2 in the unfiltered set

    await store.clearFilter();

    expect(store.getSnapshot().whereExpr).toBeNull();
    expect(store.getSnapshot().selectedHandle).toBe("H2");
    expect(store.getSnapshot().selectedIndex).toBe(1);
    expect(store.getSnapshot().selectionIsDefault).toBe(false);
  });

  it("is a no-op when no filter is active", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    const before = store.getSnapshot();
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();

    await store.clearFilter();

    expect(store.getSnapshot()).toBe(before);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("falls back to the new dataset's default selection if the selected record no longer resolves", async () => {
    const store = new ViewStore(TAG_VIEW, getSql);
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H2")], next_after: null },
      totalCount: 1,
    });
    await store.runQuery("name == 'Chores'", false);
    expect(store.getSnapshot().selectedHandle).toBe("H2");

    // navigateToHandle()'s internal runQuery(null, false), dropping the filter:
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1"), tagRow("H3")], next_after: null },
      totalCount: 2,
    });
    vi.mocked(fetchByHandle).mockResolvedValueOnce(null); // H2 was deleted concurrently

    // clearFilter()'s own fallback runQuery(null, false), once navigateToHandle gives up:
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1"), tagRow("H3")], next_after: null },
      totalCount: 2,
    });

    await store.clearFilter();

    expect(store.getSnapshot().whereExpr).toBeNull();
    expect(store.getSnapshot().selectedHandle).toBe("H1");
    expect(store.getSnapshot().selectionIsDefault).toBe(true);
  });
});

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

  it("falls back to the default selection when the selected row itself is live-deleted", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    store.select(0); // H1

    await store.applyLiveChange(notification("H1", "DELETE"));

    // H1 is gone, so the selection can't follow it -- but with rows still
    // present the detail panes get the first survivor rather than being
    // blanked (applyDefaultSelection), flagged as a default so
    // useHistorySync keeps it out of the URL.
    expect(store.getSnapshot().selectedHandle).toBe("H2");
    expect(store.getSnapshot().selectedIndex).toBe(0);
    expect(store.getSnapshot().selectionIsDefault).toBe(true);
  });

  it("clears the selection entirely when the last remaining row is live-deleted", async () => {
    const store = await loadedStore([tagRow("H1")]);
    store.select(0); // H1

    await store.applyLiveChange(notification("H1", "DELETE"));

    // Nothing left to fall back to -- the empty state is real here.
    expect(store.getSnapshot().selectedIndex).toBeNull();
    expect(store.getSnapshot().selectedHandle).toBeNull();
    expect(store.getSnapshot().selectionIsDefault).toBe(false);
  });
});

describe("ViewStore.toggleSelect (ctrl/cmd+click multi-select)", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  it("adds a second row to the selection without dropping the first, and makes it the new anchor", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3")]);
    store.select(0); // H1

    store.toggleSelect(2); // ctrl+click H3

    const snap = store.getSnapshot();
    expect(snap.selectedHandles).toEqual(["H1", "H3"]);
    expect(snap.selectedIndices).toEqual([0, 2]);
    expect(snap.selectedHandle).toBe("H3"); // anchor = most recently toggled
    expect(snap.selectedIndex).toBe(2);
  });

  it("removes a row from the selection on a second ctrl+click, without disturbing the rest", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3")]);
    store.select(0); // H1
    store.toggleSelect(1); // + H2
    store.toggleSelect(2); // + H3

    store.toggleSelect(1); // ctrl+click H2 again -- removes it

    const snap = store.getSnapshot();
    expect(snap.selectedHandles).toEqual(["H1", "H3"]);
    expect(snap.selectedIndices).toEqual([0, 2]);
    // The anchor (H3) wasn't touched, so it stays the anchor.
    expect(snap.selectedHandle).toBe("H3");
  });

  it("falls back to the new last-selected handle as anchor when the anchor itself is toggled off", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    store.select(0); // H1
    store.toggleSelect(1); // + H2, H2 is now the anchor

    store.toggleSelect(1); // ctrl+click H2 again -- removes the anchor

    const snap = store.getSnapshot();
    expect(snap.selectedHandles).toEqual(["H1"]);
    expect(snap.selectedHandle).toBe("H1");
    expect(snap.selectedIndex).toBe(0);
  });

  it("empties the selection entirely when the only selected row is toggled off -- no default reselect", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    store.select(0); // H1

    store.toggleSelect(0); // ctrl+click H1 again

    const snap = store.getSnapshot();
    expect(snap.selectedHandles).toEqual([]);
    expect(snap.selectedHandle).toBeNull();
    expect(snap.selectedIndex).toBeNull();
  });

  it("a plain select() collapses a multi-selection back to just the clicked row", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3")]);
    store.select(0);
    store.toggleSelect(1);
    store.toggleSelect(2);
    expect(store.getSnapshot().selectedHandles.length).toBe(3);

    store.select(1); // plain click H2

    const snap = store.getSnapshot();
    expect(snap.selectedHandles).toEqual(["H2"]);
    expect(snap.selectedHandle).toBe("H2");
  });

  it("clearSelection() drops the whole multi-selection, not just the anchor", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    store.select(1); // H2 (not the default row 0, so clearSelection has work to do)
    store.toggleSelect(0); // + H1

    store.clearSelection();

    // Falls back to the view's default (row 0 = H1) same as the single-select case.
    const snap = store.getSnapshot();
    expect(snap.selectedHandles).toEqual(["H1"]);
    expect(snap.selectionIsDefault).toBe(true);
  });

  it("drops a multi-selected (non-anchor) handle that a live delete removes, keeping the rest and the anchor", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3")]);
    store.select(0); // H1
    store.toggleSelect(2); // + H3, H3 is now the anchor

    await store.applyLiveChange(notification("H1", "DELETE"));

    const snap = store.getSnapshot();
    expect(snap.selectedHandles).toEqual(["H3"]);
    expect(snap.selectedHandle).toBe("H3"); // anchor untouched
    expect(snap.selectedIndex).toBe(1); // shifted up by H1's removal
  });

  it("falls back to the new last-remaining handle as anchor when a live delete removes the anchor out of a multi-selection", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3")]);
    store.select(0); // H1
    store.toggleSelect(2); // + H3, H3 is now the anchor

    await store.applyLiveChange(notification("H3", "DELETE"));

    const snap = store.getSnapshot();
    expect(snap.selectedHandles).toEqual(["H1"]);
    expect(snap.selectedHandle).toBe("H1");
    expect(snap.selectedIndex).toBe(0);
  });
});

describe("ViewStore.selectRange (shift+click range-select)", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  it("selects every row between the anchor and the shift-clicked row, inclusive", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3"), tagRow("H4")]);
    store.select(0); // H1 -- the anchor

    store.selectRange(2, 50); // shift+click H3

    const snap = store.getSnapshot();
    expect(snap.selectedHandles).toEqual(["H1", "H2", "H3"]);
    expect(snap.selectedIndices).toEqual([0, 1, 2]);
  });

  it("works in either direction from the anchor", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3"), tagRow("H4")]);
    store.select(3); // H4 -- the anchor

    store.selectRange(1, 50); // shift+click H2, above the anchor

    const snap = store.getSnapshot();
    expect(snap.selectedHandles).toEqual(["H2", "H3", "H4"]);
    expect(snap.selectedIndices).toEqual([1, 2, 3]);
  });

  it("sets the anchor as the just-shift-clicked endpoint, not the last array element", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3"), tagRow("H4")]);
    store.select(3); // H4 -- the anchor

    store.selectRange(1, 50); // shift+click H2, above the anchor -- H4 ends up last in the array

    const snap = store.getSnapshot();
    // The array is in ascending index order (H2..H4), but the endpoint the
    // user actually just clicked was H2 -- that's what selectedHandle must
    // report, not array[length-1] (which would wrongly be H4 here).
    expect(snap.selectedHandle).toBe("H2");
    expect(snap.selectedIndex).toBe(1);
  });

  it("keeps extending/shrinking from the same fixed anchor across repeated shift+clicks", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3"), tagRow("H4"), tagRow("H5")]);
    store.select(1); // H2 -- the anchor
    store.selectRange(3, 50); // shift+click H4 -> H2..H4
    expect(store.getSnapshot().selectedHandles).toEqual(["H2", "H3", "H4"]);

    store.selectRange(4, 50); // shift+click H5 -> extends from the *original* anchor (H2), not H4

    expect(store.getSnapshot().selectedHandles).toEqual(["H2", "H3", "H4", "H5"]);
  });

  it("does nothing at all when the range would exceed the cap", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3")]);
    store.select(0); // H1
    const before = store.getSnapshot();

    store.selectRange(2, 2); // H1..H3 is 3 rows, over the cap of 2

    expect(store.getSnapshot()).toBe(before); // unchanged reference -> no emit at all
  });

  it("a plain click afterward moves the range anchor to the newly clicked row", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3"), tagRow("H4")]);
    store.select(0); // H1 -- the anchor
    store.select(2); // plain click H3 -- anchor moves here

    store.selectRange(3, 50); // shift+click H4 -> range is H3..H4, not H1..H4

    expect(store.getSnapshot().selectedHandles).toEqual(["H3", "H4"]);
  });

  it("ctrl+click also moves the range anchor", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3"), tagRow("H4")]);
    store.select(0); // H1 -- the anchor
    store.toggleSelect(2); // ctrl+click H3 -- anchor moves here, H1 stays selected too

    store.selectRange(3, 50); // shift+click H4 -> range is H3..H4, replacing the whole prior selection

    expect(store.getSnapshot().selectedHandles).toEqual(["H3", "H4"]);
  });
});
