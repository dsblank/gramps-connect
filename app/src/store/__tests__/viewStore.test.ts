import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import type { TreeChangeNotification } from "../historyPoll";
import { EVENT_VIEW, FAMILY_VIEW, PERSON_VIEW, PLACE_VIEW, TAG_VIEW } from "../views";

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

function personRow(handle: string, overrides: Partial<Record<string, unknown>> = {}) {
  return { handle, gramps_id: handle, surname: "Smith", given_name: "Amy", change: 1000, ...overrides };
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

  it("queues a live-sync trigger that arrives while a background fill is still walking, instead of restarting it", async () => {
    vi.useFakeTimers();
    try {
      const store = new ViewStore(TAG_VIEW, getSql);

      // Held open deliberately -- simulates the fill's second page still
      // being in flight (e.g. a slow Postgres table scan) when the next
      // live-sync notification arrives.
      let resolvePage2!: (value: Awaited<ReturnType<typeof fetchPage>>) => void;
      const page2 = new Promise<Awaited<ReturnType<typeof fetchPage>>>((resolve) => {
        resolvePage2 = resolve;
      });

      vi.mocked(fetchPage)
        .mockResolvedValueOnce({ page: { items: [tagRow("H1")], next_after: "H1" }, totalCount: 2 })
        .mockReturnValueOnce(page2)
        .mockResolvedValueOnce({ page: { items: [tagRow("H3")], next_after: null }, totalCount: 1 });

      store.requeryDebounced(1);
      await vi.advanceTimersByTimeAsync(300); // fires the debounce, starts the requery

      // Page one landed and the background fill moved on to page two --
      // that's the second fetchPage() call, still unresolved.
      expect(fetchPage).toHaveBeenCalledTimes(2);

      // A second live-sync trigger arrives while that fill is still
      // walking. If it restarted the query (the old behavior), this would
      // bump queryGeneration and abort the in-flight page-two fetch.
      store.requeryDebounced(2);
      await vi.advanceTimersByTimeAsync(300);

      // Queued, not restarted: still only the two calls from the original
      // fill -- no new runQuery() was started out from under it.
      expect(fetchPage).toHaveBeenCalledTimes(2);

      // The original fill finishes...
      resolvePage2({ page: { items: [tagRow("H2")], next_after: null }, totalCount: 2 });
      await vi.waitFor(() => expect(store.getSnapshot().totalCount).toBe(2), { timeout: 5000 });

      // ...which runs the queued requery right away rather than dropping
      // it, landing the coalesced cursor's data.
      await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(3), { timeout: 5000 });
      await vi.waitFor(() => expect(store.getSnapshot().totalCount).toBe(1), { timeout: 5000 });
    } finally {
      vi.useRealTimers();
    }
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

    // findGlobalIndex()'s resolution (fetchByHandle + rank) now runs
    // *before* the drop-the-filter requery, not after -- see
    // navigateToHandle's doc comment on why the requery's own swap-in has
    // to carry the correct selection already known, not fix it up afterward.
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H2"));
    mockRank(1); // H1 sorts before H2 in the unfiltered set
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1"), tagRow("H2"), tagRow("H3")], next_after: null },
      totalCount: 3,
    });

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

  it("restores the pre-filter selection, not the filtered set's own default, when the filter is cleared without an explicit click into it (regression: a GOQL query whose results didn't include the original record left the default-selected row behind after clearing)", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3")]);
    store.select(2); // explicitly on H3 before any filter is applied

    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H2")], next_after: null },
      totalCount: 1,
    });
    await store.runQuery("name == 'Chores'", false);
    // Filtering away from H3 leaves only H2, auto-selected as the new
    // default -- the user never clicked it.
    expect(store.getSnapshot().selectedHandle).toBe("H2");
    expect(store.getSnapshot().selectionIsDefault).toBe(true);

    // findGlobalIndex()'s resolution (fetchByHandle + rank), ahead of
    // navigateToHandle()'s own drop-the-filter requery:
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H3"));
    mockRank(2); // H3's rank in the unfiltered set
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1"), tagRow("H2"), tagRow("H3")], next_after: null },
      totalCount: 3,
    });

    await store.clearFilter();

    expect(store.getSnapshot().whereExpr).toBeNull();
    expect(store.getSnapshot().selectedHandle).toBe("H3");
    expect(store.getSnapshot().selectedIndex).toBe(2);
    expect(store.getSnapshot().selectionIsDefault).toBe(false);
  });

  it("still tie-breaks by ascending handle when the active sort is descending (regression: clearing a search under a descending sort could land the highlight on a different row than selectedHandle, whenever ties existed in the sort column)", async () => {
    const store = new ViewStore(TAG_VIEW, getSql);
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1"), tagRow("H2")], next_after: null },
      totalCount: 2,
    });
    await store.runQuery(null, false);

    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H2"), tagRow("H1")], next_after: null },
      totalCount: 2,
    });
    await store.setSort("name"); // toggles the default column's initial "asc" to "desc"
    expect(store.getSnapshot().orderBy).toEqual({ column: "name", direction: "desc" });

    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H2")], next_after: null },
      totalCount: 1,
    });
    await store.runQuery("name == 'Chores'", false);
    expect(store.getSnapshot().selectedHandle).toBe("H2");

    // findGlobalIndex()'s resolution (fetchByHandle + rank), ahead of
    // navigateToHandle()'s own drop-the-filter requery:
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H2"));
    mockRank(0); // H2 sorts first under the descending order
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H2"), tagRow("H1")], next_after: null },
      totalCount: 2,
    });

    await store.clearFilter();

    // globalRankOfItem()'s count-only rank query -- its where_expr is the
    // 5th positional argument to fetchPage(). The handle half of its
    // tie-break must stay "<" (ascending) even though the primary column
    // is sorted "desc": the server's effective_order_by always appends an
    // ascending handle tiebreak, regardless of the primary column's own
    // direction.
    const calls = vi.mocked(fetchPage).mock.calls;
    const rankCallArgs = calls[calls.length - 2]; // 2nd-to-last: last is the drop-query itself
    const whereExprArg = rankCallArgs[4] as string;
    expect(whereExprArg).toContain('handle < "H2"');
    expect(whereExprArg).not.toContain('handle > "H2"');
  });
});

describe("ViewStore picker filter + typed whereExpr combination", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  it("ANDs the picker's pickerExpr with an already-applied typed whereExpr, not replacing it", async () => {
    const store = new ViewStore(TAG_VIEW, getSql);
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1")], next_after: null },
      totalCount: 1,
    });
    await store.runQuery("name == 'Chores'", false);
    expect(store.getSnapshot().whereExpr).toBe("name == 'Chores'");

    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1")], next_after: null },
      totalCount: 1,
    });
    await store.setPickerFilter("priority == 1");

    expect(store.getSnapshot().whereExpr).toBe("name == 'Chores'"); // untouched by the picker
    expect(store.getSnapshot().pickerExpr).toBe("priority == 1");
    const calls = vi.mocked(fetchPage).mock.calls;
    expect(calls[calls.length - 1][4]).toBe("(priority == 1) and (name == 'Chores')");
  });

  it("keeps an active pickerExpr in place when a new typed search is applied afterward", async () => {
    const store = new ViewStore(TAG_VIEW, getSql);
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1")], next_after: null },
      totalCount: 1,
    });
    await store.setPickerFilter("priority == 1");

    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1")], next_after: null },
      totalCount: 1,
    });
    await store.runQuery("name == 'Chores'", false);

    expect(store.getSnapshot().pickerExpr).toBe("priority == 1"); // untouched by FilterBar's own apply
    const calls = vi.mocked(fetchPage).mock.calls;
    expect(calls[calls.length - 1][4]).toBe("(priority == 1) and (name == 'Chores')");
  });

  it("clearFilter() drops only the typed whereExpr, leaving an active pickerExpr applied", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1")], next_after: null },
      totalCount: 1,
    });
    await store.setPickerFilter("priority == 1");
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1")], next_after: null },
      totalCount: 1,
    });
    await store.runQuery("name == 'Chores'", false);
    expect(store.getSnapshot().selectedHandle).toBe("H1");

    // findGlobalIndex()'s resolution -- membership check, then rank --
    // now runs *before* navigateToHandle()'s own requery below, so its
    // atomic pendingSelection is already known once that requery lands.
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H1"));
    vi.mocked(fetchPage).mockResolvedValueOnce({ page: { items: [], next_after: null }, totalCount: 1 }); // membership check
    mockRank(0);
    // navigateToHandle()'s own requery, dropping only whereExpr:
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1")], next_after: null },
      totalCount: 1,
    });

    await store.clearFilter();

    expect(store.getSnapshot().whereExpr).toBeNull();
    expect(store.getSnapshot().pickerExpr).toBe("priority == 1");
    expect(store.getSnapshot().selectedHandle).toBe("H1");
    expect(store.getSnapshot().selectedIndex).toBe(0);
    const calls = vi.mocked(fetchPage).mock.calls;
    // navigateToHandle's own requery (the last call) must still carry
    // pickerExpr -- only whereExpr was dropped.
    expect(calls[calls.length - 1][4]).toBe("(priority == 1)");
  });

  it("clearPickerFilter() drops only pickerExpr, leaving an active typed whereExpr applied", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1")], next_after: null },
      totalCount: 1,
    });
    await store.runQuery("name == 'Chores'", false);
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1")], next_after: null },
      totalCount: 1,
    });
    await store.setPickerFilter("priority == 1");
    expect(store.getSnapshot().selectedHandle).toBe("H1");

    // findGlobalIndex()'s resolution -- membership check, then rank --
    // now runs *before* navigateToHandle()'s own requery below.
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H1"));
    vi.mocked(fetchPage).mockResolvedValueOnce({ page: { items: [], next_after: null }, totalCount: 1 }); // membership check
    mockRank(0);
    // navigateToHandle()'s own requery, dropping only pickerExpr:
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1")], next_after: null },
      totalCount: 1,
    });

    await store.clearPickerFilter();

    expect(store.getSnapshot().pickerExpr).toBeNull();
    expect(store.getSnapshot().whereExpr).toBe("name == 'Chores'");
    expect(store.getSnapshot().selectedHandle).toBe("H1");
    expect(store.getSnapshot().selectedIndex).toBe(0);
    const calls = vi.mocked(fetchPage).mock.calls;
    // navigateToHandle's own requery (the last call) must still carry
    // whereExpr -- only pickerExpr was dropped.
    expect(calls[calls.length - 1][4]).toBe("(name == 'Chores')");
    // globalRankOfItem()'s own rank query (2nd-to-last call) must still
    // restrict ranking to the still-active whereExpr's matching subset --
    // regression: it used to rank against every row in the table,
    // dropping the active search from the ranking query entirely (see
    // globalRankOfItem's own doc comment).
    const rankExprArg = calls[calls.length - 2][4] as string;
    expect(rankExprArg).toContain("name == 'Chores'");
  });

  it("navigateToHandle() drops both whereExpr and pickerExpr by default (following a link ignores every active filter)", async () => {
    const store = new ViewStore(TAG_VIEW, getSql);
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1")], next_after: null },
      totalCount: 1,
    });
    await store.setPickerFilter("priority == 1");
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1")], next_after: null },
      totalCount: 1,
    });
    await store.runQuery("name == 'Chores'", false);

    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1"), tagRow("H2")], next_after: null },
      totalCount: 2,
    });
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H2"));
    mockRank(1); // H2's rank once both filters are dropped

    const ok = await store.navigateToHandle("H2");

    expect(ok).toBe(true);
    expect(store.getSnapshot().whereExpr).toBeNull();
    expect(store.getSnapshot().pickerExpr).toBeNull();
  });
});

describe("ViewStore.applyWhereExpr (FilterBar's search box, applying a new term rather than clearing)", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  it("keeps the selected record selected when a new search term still matches it, rather than jumping to the new result set's row 0", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    store.select(1); // H2, not the default row
    expect(store.getSnapshot().selectedHandle).toBe("H2");

    // findGlobalIndex()'s resolution -- fetchByHandle, membership check,
    // then rank -- runs *before* the search's own requery below, so the
    // requery's swap-in can carry the correct selection atomically (see
    // runQueryPreservingSelection's doc comment).
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H2"));
    vi.mocked(fetchPage).mockResolvedValueOnce({ page: { items: [], next_after: null }, totalCount: 1 }); // membership check
    mockRank(0); // H2 sorts first among the matches
    // The typed search matches both rows, H2 first this time -- if
    // selection just fell back to "row 0 of the new results" (the bug this
    // guards against), it would land on H2 anyway by coincidence, so the
    // seed order here is H2 then H1 specifically to catch that.
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H2"), tagRow("H1")], next_after: null },
      totalCount: 2,
    });

    await store.applyWhereExpr("name == 'Chores'");

    expect(store.getSnapshot().selectedHandle).toBe("H2");
    expect(store.getSnapshot().selectedIndex).toBe(0);
    expect(store.getSnapshot().selectionIsDefault).toBe(false);
  });

  it("falls back to the new result set's default (row 0) when the selected record is filtered out by the new search", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    store.select(1); // H2
    expect(store.getSnapshot().selectedHandle).toBe("H2");

    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H2")); // H2 still exists as a record...
    // ...but findGlobalIndex()'s membership check finds it doesn't match
    // the new filter (0 rows: this filter and handle == "H2" together) --
    // resolved before the search's own requery, same as the test above.
    vi.mocked(fetchPage).mockResolvedValueOnce({ page: { items: [], next_after: null }, totalCount: 0 });
    // The new search only matches H1 -- H2 no longer exists in the result
    // set at all.
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1")], next_after: null },
      totalCount: 1,
    });

    await store.applyWhereExpr("name == 'Errands'");

    expect(store.getSnapshot().selectedHandle).toBe("H1");
    expect(store.getSnapshot().selectedIndex).toBe(0);
    expect(store.getSnapshot().selectionIsDefault).toBe(true);
  });
});

describe("ViewStore.setSort secondary sort (Person's surname/given_name pair)", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  it("sorts by given_name then surname when the Given name column is clicked", async () => {
    const store = new ViewStore(PERSON_VIEW, getSql);
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [personRow("H1")], next_after: null },
      totalCount: 1,
    });
    await store.runQuery(null, false);

    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [personRow("H1")], next_after: null },
      totalCount: 1,
    });
    await store.setSort("given_name");

    expect(store.getSnapshot().orderBy).toEqual({ column: "given_name", direction: "asc" });
    const calls = vi.mocked(fetchPage).mock.calls;
    const orderByArg = calls[calls.length - 1][5];
    expect(orderByArg).toEqual([
      { column: "given_name", direction: "asc" },
      { column: "surname", direction: "asc" },
    ]);
  });

  it("keeps the surname tiebreak alongside a repeat click's reversed direction", async () => {
    const store = new ViewStore(PERSON_VIEW, getSql);
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [personRow("H1")], next_after: null },
      totalCount: 1,
    });
    await store.runQuery(null, false);

    // Surname is already the view's default sort column ("asc") -- the
    // first click reverses it, same as any other column's repeat click.
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [personRow("H1")], next_after: null },
      totalCount: 1,
    });
    await store.setSort("surname");

    expect(store.getSnapshot().orderBy).toEqual({ column: "surname", direction: "desc" });
    const calls = vi.mocked(fetchPage).mock.calls;
    const orderByArg = calls[calls.length - 1][5];
    expect(orderByArg).toEqual([
      { column: "surname", direction: "desc" },
      { column: "given_name", direction: "desc" },
    ]);
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
    expect(store.getRows(0, 10)).toEqual([["New", "#ff0000", 1, 1000, "H1"]]);
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

    store.selectRange(2); // shift+click H3

    const snap = store.getSnapshot();
    expect(snap.selectedHandles).toEqual(["H1", "H2", "H3"]);
    expect(snap.selectedIndices).toEqual([0, 1, 2]);
  });

  it("works in either direction from the anchor", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3"), tagRow("H4")]);
    store.select(3); // H4 -- the anchor

    store.selectRange(1); // shift+click H2, above the anchor

    const snap = store.getSnapshot();
    expect(snap.selectedHandles).toEqual(["H2", "H3", "H4"]);
    expect(snap.selectedIndices).toEqual([1, 2, 3]);
  });

  it("sets the anchor as the just-shift-clicked endpoint, not the last array element", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3"), tagRow("H4")]);
    store.select(3); // H4 -- the anchor

    store.selectRange(1); // shift+click H2, above the anchor -- H4 ends up last in the array

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
    store.selectRange(3); // shift+click H4 -> H2..H4
    expect(store.getSnapshot().selectedHandles).toEqual(["H2", "H3", "H4"]);

    store.selectRange(4); // shift+click H5 -> extends from the *original* anchor (H2), not H4

    expect(store.getSnapshot().selectedHandles).toEqual(["H2", "H3", "H4", "H5"]);
  });

  it("selects a range of thousands of rows -- no cap", async () => {
    const rows = Array.from({ length: 3000 }, (_, i) => tagRow(`H${String(i).padStart(4, "0")}`));
    const store = await loadedStore(rows);
    store.select(10);

    store.selectRange(2509);

    const snap = store.getSnapshot();
    expect(snap.selectedHandles).toHaveLength(2500);
    expect(snap.selectedHandles[0]).toBe("H0010");
    expect(snap.selectedHandles[2499]).toBe("H2509");
    expect(snap.selectedIndices[2499]).toBe(2509);
    expect(snap.selectedHandle).toBe("H2509");
  });

  it("a plain click afterward moves the range anchor to the newly clicked row", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3"), tagRow("H4")]);
    store.select(0); // H1 -- the anchor
    store.select(2); // plain click H3 -- anchor moves here

    store.selectRange(3); // shift+click H4 -> range is H3..H4, not H1..H4

    expect(store.getSnapshot().selectedHandles).toEqual(["H3", "H4"]);
  });

  it("ctrl+click also moves the range anchor", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3"), tagRow("H4")]);
    store.select(0); // H1 -- the anchor
    store.toggleSelect(2); // ctrl+click H3 -- anchor moves here, H1 stays selected too

    store.selectRange(3); // shift+click H4 -> range is H3..H4, replacing the whole prior selection

    expect(store.getSnapshot().selectedHandles).toEqual(["H3", "H4"]);
  });
});

describe("ViewStore.selectAll (Ctrl/Cmd+A)", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  it("selects every row, keeping the already-selected row as the anchor", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3")]);
    store.select(1);

    await store.selectAll();

    const snap = store.getSnapshot();
    expect(snap.selectedHandles).toEqual(["H1", "H2", "H3"]);
    expect(snap.selectedIndices).toEqual([0, 1, 2]);
    expect(snap.selectedHandle).toBe("H2");
    expect(snap.selectedIndex).toBe(1);
    expect(snap.selectionIsDefault).toBe(false);
  });

  it("waits for the background fill, so rows past the first page are included", async () => {
    const store = new ViewStore(TAG_VIEW, getSql);
    let resolvePage2!: (value: Awaited<ReturnType<typeof fetchPage>>) => void;
    const page2 = new Promise<Awaited<ReturnType<typeof fetchPage>>>((resolve) => {
      resolvePage2 = resolve;
    });
    vi.mocked(fetchPage)
      .mockResolvedValueOnce({ page: { items: [tagRow("H1")], next_after: "H1" }, totalCount: 2 })
      .mockReturnValueOnce(page2);
    await store.runQuery(null, false);

    const selecting = store.selectAll();
    resolvePage2({ page: { items: [tagRow("H2")], next_after: null }, totalCount: 2 });
    await selecting;

    expect(store.getSnapshot().selectedHandles).toEqual(["H1", "H2"]);
  });

  it("does nothing if the query changes while waiting for the fill", async () => {
    const store = new ViewStore(TAG_VIEW, getSql);
    let resolvePage2!: (value: Awaited<ReturnType<typeof fetchPage>>) => void;
    const page2 = new Promise<Awaited<ReturnType<typeof fetchPage>>>((resolve) => {
      resolvePage2 = resolve;
    });
    vi.mocked(fetchPage)
      .mockResolvedValueOnce({ page: { items: [tagRow("H1")], next_after: "H1" }, totalCount: 2 })
      .mockReturnValueOnce(page2)
      .mockResolvedValueOnce({ page: { items: [tagRow("H9")], next_after: null }, totalCount: 1 });
    await store.runQuery(null, false);

    const selecting = store.selectAll();
    await store.runQuery('name == "x"', false);
    resolvePage2({ page: { items: [tagRow("H2")], next_after: null }, totalCount: 2 });
    await selecting;

    expect(store.getSnapshot().selectedHandles).toEqual(["H9"]);
  });

  it("keeps a large selection's indices right when a live delete shifts rows", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => tagRow(`H${String(i).padStart(3, "0")}`));
    const store = await loadedStore(rows);
    store.select(0);
    store.selectRange(49); // H000..H049, over the one-pass lookup threshold
    vi.mocked(fetchByHandle).mockResolvedValueOnce(null);

    await store.applyLiveChange(notification("H010", "DELETE"));

    const snap = store.getSnapshot();
    expect(snap.selectedHandles).toHaveLength(49);
    expect(snap.selectedHandles).not.toContain("H010");
    expect(snap.selectedIndices[10]).toBe(10); // H011 moved up into H010's place
    expect(snap.selectedHandles[10]).toBe("H011");
  });
});

describe("ViewStore.readItemsByHandles (bulk pane labels from the cache)", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  it("returns cached rows keyed by handle, in /query/ item shape, skipping unknown handles", async () => {
    const store = await loadedStore([tagRow("H1", { name: "Chores" }), tagRow("H2", { name: "Todo" }), tagRow("H3")]);

    const items = store.readItemsByHandles(["H2", "H1", "NOPE"]);

    expect([...items.keys()].sort()).toEqual(["H1", "H2"]);
    expect(items.get("H2")).toMatchObject({ handle: "H2", name: "Todo", priority: 1 });
  });

  it("labels a cached event as \"Type: date\", like its record header", async () => {
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: {
        items: [{
          handle: "E1", gramps_id: "E0001", description: "Birth of Amy", change: 1000,
          event_type: { _class: "EventType", string: "", value: 12 },
          date: { _class: "Date", calendar: 0, modifier: 0, quality: 0, dateval: [0, 0, 1990, false], text: "", sortval: 2447893, newyear: 0 },
        }],
        next_after: null,
      },
      totalCount: 1,
    });
    const store = new ViewStore(EVENT_VIEW, getSql);
    await store.runQuery(null, false);

    const item = store.readItemsByHandles(["E1"]).get("E1")!;
    const { cachedLabel } = await import("../../components/related/SelectionBulkView");
    const label = cachedLabel(EVENT_VIEW, item);

    expect(label).toMatch(/^\[E0001\] Birth: .*1990/);
    expect(label).not.toContain("Birth of Amy");
  });

  it("gives a person row whose label pickerResultLabel can build (name stored as JSON)", async () => {
    const primary_name = {
      _class: "Name", first_name: "Amy", surname_list: [{ _class: "Surname", surname: "Smith", primary: true }],
      suffix: "", title: "", call: "", nick: "", famnick: "",
    };
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [personRow("H1", { gramps_id: "I0001", primary_name })], next_after: null },
      totalCount: 1,
    });
    const store = new ViewStore(PERSON_VIEW, getSql);
    await store.runQuery(null, false);

    const item = store.readItemsByHandles(["H1"]).get("H1")!;
    const { pickerResultLabel } = await import("../../components/RefPickerField");
    const label = pickerResultLabel("person", item as never);

    expect(label).toMatch(/^\[I0001\] /);
    expect(label).toContain("Amy");
    expect(label).toContain("Smith");
  });
});

describe("ViewStore.removeDeleted (after this tab's own bulk delete)", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  it("drops the rows at once, so the selection falls back to a row that still exists", async () => {
    const store = await loadedStore([tagRow("A"), tagRow("B"), tagRow("C"), tagRow("D")]);
    store.select(0);
    store.selectRange(2); // A..C, then deleted on the server

    store.removeDeleted(["A", "B", "C"]);

    const snap = store.getSnapshot();
    // Regression: falling back to row 0 of the stale cache selected "A",
    // which the detail pane then fetched and got a 404 for.
    expect(snap.selectedHandle).toBe("D");
    expect(snap.selectedHandles).toEqual(["D"]);
    expect(snap.selectedIndex).toBe(0);
    expect(snap.totalCount).toBe(1);
    expect(snap.loadedCount).toBe(1);
  });

  it("selects nothing when every row was deleted", async () => {
    const store = await loadedStore([tagRow("A"), tagRow("B")]);
    store.select(0);
    store.selectRange(1);

    store.removeDeleted(["A", "B"]);

    expect(store.getSnapshot().selectedHandle).toBeNull();
    expect(store.getSnapshot().totalCount).toBe(0);
  });

  it("only counts rows it actually had", async () => {
    const store = await loadedStore([tagRow("A"), tagRow("B")]);
    store.removeDeleted(["A", "NOT-LOADED"]);
    expect(store.getSnapshot().totalCount).toBe(1);
  });
});

describe("ViewStore selection consistency across every emitted frame (not just the final one)", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  it("never emits a snapshot pairing selectedIndex against a different row than selectedHandle while clearFilter() resolves (regression: DataTable highlights purely by index, and runQuery()'s own page-one swap-in used to emit while suppressSelectionClear was still holding the *old* selectedIndex, now paired against the *new* rows, until the async reselect caught up a moment later)", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3")]);
    store.select(2); // H3

    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H3")], next_after: null },
      totalCount: 1,
    });
    await store.runQuery("name == 'Chores'", false);
    expect(store.getSnapshot().selectedHandle).toBe("H3");

    const badFrames: Array<{ selectedIndex: number; selectedHandle: string | null; handleAtIndex: unknown }> = [];
    const unsubscribe = store.subscribe(() => {
      const snap = store.getSnapshot();
      if (snap.selectedIndex === null) return;
      const handleAtIndex = store.readColumns(["handle"])[snap.selectedIndex]?.[0];
      if (handleAtIndex !== undefined && handleAtIndex !== snap.selectedHandle) {
        badFrames.push({ selectedIndex: snap.selectedIndex, selectedHandle: snap.selectedHandle, handleAtIndex });
      }
    });

    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H3"));
    mockRank(2); // H3's rank in the unfiltered set
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [tagRow("H1"), tagRow("H2"), tagRow("H3")], next_after: null },
      totalCount: 3,
    });

    await store.clearFilter();
    unsubscribe();

    expect(badFrames).toEqual([]);
    expect(store.getSnapshot().selectedHandle).toBe("H3");
    expect(store.getSnapshot().selectedIndex).toBe(2);
  });
});

describe("ViewStore path sort keys (orderPath)", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  function placeRow(handle: string, name: string, title: string) {
    return { handle, gramps_id: handle, title, name_value: name, name: JSON.stringify({ value: name }) };
  }

  it("ranks by a GOQL path using the column that caches it, with the stored title as tiebreak", async () => {
    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [placeRow("P1", "Aurora", ""), placeRow("P2", "Springfield", "Springfield, IL")], next_after: null },
      totalCount: 2,
    });
    const store = new ViewStore(PLACE_VIEW, getSql);
    await store.runQuery(null, false);
    expect(store.getSnapshot().orderBy).toEqual({ column: "name.value", direction: "asc" });

    vi.mocked(fetchByHandle).mockResolvedValueOnce(placeRow("P1", "Zion", "Zion, IL"));
    mockRank(1);
    await store.applyLiveChange({ table: "place", handle: "P1", op: "UPDATE", changedBy: null });

    const rankExpr = vi.mocked(fetchPage).mock.calls[vi.mocked(fetchPage).mock.calls.length - 1][4] as string;
    expect(rankExpr).toContain('name.value < "Zion"');
    expect(rankExpr).toContain('name.value == "Zion" and title < "Zion, IL"');
    expect(store.getRows(0, 10).map((row) => row[PLACE_VIEW.columns.findIndex((c) => c.key === "name_value")])).toEqual(["Springfield", "Zion"]);
  });

  it("clicking the Title header sorts by name, then title", async () => {
    vi.mocked(fetchPage).mockResolvedValue({ page: { items: [], next_after: null }, totalCount: 0 });
    const store = new ViewStore(PLACE_VIEW, getSql);
    await store.runQuery(null, false);
    await store.setSort("name.value");
    // Already ascending by default -> the click reverses it, title tiebreak too.
    const orderBy = vi.mocked(fetchPage).mock.calls[vi.mocked(fetchPage).mock.calls.length - 1][5];
    expect(orderBy).toEqual([{ column: "name.value", direction: "desc" }, { column: "title", direction: "desc" }]);
  });
});

describe("ViewStore.whenFullyLoaded", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  it("waits for the background fill, not just the first page", async () => {
    const store = new ViewStore(TAG_VIEW, getSql);
    let resolvePage2!: (value: Awaited<ReturnType<typeof fetchPage>>) => void;
    const page2 = new Promise<Awaited<ReturnType<typeof fetchPage>>>((resolve) => {
      resolvePage2 = resolve;
    });
    vi.mocked(fetchPage)
      .mockResolvedValueOnce({ page: { items: [tagRow("H1")], next_after: "H1" }, totalCount: 2 })
      .mockReturnValueOnce(page2);
    await store.runQuery(null, false);
    expect(store.getSnapshot().loadedCount).toBe(1);

    let done = false;
    const waiting = store.whenFullyLoaded().then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);

    resolvePage2({ page: { items: [tagRow("H2")], next_after: null }, totalCount: 2 });
    await waiting;
    expect(store.readColumns(["handle"]).map((r) => r[0])).toEqual(["H1", "H2"]);
  });

  it("returns at once when everything is already loaded", async () => {
    const store = await loadedStore([tagRow("H1")]);
    await store.whenFullyLoaded();
    expect(store.getSnapshot().loadedCount).toBe(1);
  });
});

describe("ViewStore unfiltered reads", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  const page = (items: ReturnType<typeof tagRow>[], totalCount = items.length) => ({
    page: { items, next_after: null }, totalCount,
  });

  it("keeps the whole tree readable while the list is filtered, and drops the copy when cleared", async () => {
    const store = await loadedStore([tagRow("H1"), tagRow("H2"), tagRow("H3")]);

    vi.mocked(fetchPage).mockResolvedValueOnce(page([tagRow("H2", { name: "Edited" })]));
    await store.runQuery('name == "x"', false);

    // The list itself: only the match.
    expect(store.readRowByHandle("H1", ["name"])).toBeNull();
    // The whole tree: everything, with the filtered page's fresher copy.
    expect(store.readRowByHandle("H1", ["name"], { unfiltered: true })).toEqual(["Chores"]);
    expect(store.readRowByHandle("H2", ["name"], { unfiltered: true })).toEqual(["Edited"]);
    expect(store.readColumns(["handle"], { unfiltered: true })).toHaveLength(3);
    expect(store.unfilteredCounts()).toEqual({ loaded: 3, total: 3 });

    // A second filter keeps the same whole-tree copy.
    vi.mocked(fetchPage).mockResolvedValueOnce(page([tagRow("H3")]));
    await store.runQuery('name == "y"', false);
    expect(store.readColumns(["handle"], { unfiltered: true })).toHaveLength(3);

    // A delete made here while filtered leaves both.
    store.removeDeleted(["H1"]);
    expect(store.readRowByHandle("H1", ["name"], { unfiltered: true })).toBeNull();

    vi.mocked(fetchPage).mockResolvedValueOnce(page([tagRow("H2"), tagRow("H3")]));
    await store.runQuery(null, false);
    expect(store.unfilteredCounts()).toEqual({ loaded: 2, total: 2 });
    expect(store.readColumns(["handle"], { unfiltered: true })).toHaveLength(2);
  });
});

describe("ViewStore.refreshDependents (rows copying another table's data)", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  function eventRow(handle: string, place: string, placeTitle: string) {
    return { handle, gramps_id: handle, place, place_title: placeTitle, change: 1000 };
  }

  async function loadedEvents(items: ReturnType<typeof eventRow>[]): Promise<ViewStore> {
    vi.mocked(fetchPage).mockResolvedValueOnce({ page: { items, next_after: null }, totalCount: items.length });
    const store = new ViewStore(EVENT_VIEW, getSql);
    await store.runQuery(null, false);
    return store;
  }

  it("refetches just the events at an edited place and updates their copied place title", async () => {
    const store = await loadedEvents([eventRow("E1", "P1", "Rush"), eventRow("E2", "P2", "Decatur")]);
    vi.mocked(fetchPage).mockResolvedValueOnce({ page: { items: [eventRow("E1", "P1", "Rush County")], next_after: null }, totalCount: 1 });

    expect(await store.refreshDependents("place", ["P1"])).toBe("patched");

    expect(vi.mocked(fetchPage).mock.lastCall?.[4]).toBe('handle == "E1"');
    expect(store.readRowByHandle("E1", ["place_title"])).toEqual(["Rush County"]);
    expect(store.readRowByHandle("E2", ["place_title"])).toEqual(["Decatur"]);
    expect(store.getSnapshot().loadedCount).toBe(2);
  });

  it("asks nothing of the server when no cached row points at the changed records", async () => {
    const store = await loadedEvents([eventRow("E1", "P1", "Rush")]);
    const calls = vi.mocked(fetchPage).mock.calls.length;

    expect(await store.refreshDependents("place", ["P9"])).toBe("none");
    expect(await store.refreshDependents("note", ["P1"])).toBe("none");
    expect(vi.mocked(fetchPage).mock.calls.length).toBe(calls);
  });

  it("finds rows through a handle-list column (a person's events, for birth/death dates)", async () => {
    const person = { ...personRow("I1"), event_refs: [{ ref: "E1" }, { ref: "E22" }] };
    vi.mocked(fetchPage).mockResolvedValueOnce({ page: { items: [person, { ...personRow("I2"), event_refs: [{ ref: "E2" }] }], next_after: null }, totalCount: 2 });
    const store = new ViewStore(PERSON_VIEW, getSql);
    await store.runQuery(null, false);
    vi.mocked(fetchPage).mockResolvedValueOnce({ page: { items: [{ ...person, birth_date: '{"year":1900}' }], next_after: null }, totalCount: 1 });

    // E2 is a prefix of E22 but must only match I2, the person who has E2.
    expect(await store.refreshDependents("event", ["E22"])).toBe("patched");
    expect(vi.mocked(fetchPage).mock.lastCall?.[4]).toBe('handle == "I1"');
  });
});

describe("ViewStore.applyLiveChangesFiltered (live sync while a search is typed in)", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  function placeRow(handle: string, title: string) {
    return { handle, gramps_id: handle, title, name: { value: title }, change: 1000 };
  }

  it("updates the whole-tree copy and the shown match, without adding non-matches to the results", async () => {
    vi.mocked(fetchPage).mockResolvedValueOnce({ page: { items: [placeRow("P1", "Rush"), placeRow("P2", "Decatur")], next_after: null }, totalCount: 2 });
    const store = new ViewStore(PLACE_VIEW, getSql);
    await store.runQuery(null, false);
    // Searching keeps the whole-tree rows aside.
    vi.mocked(fetchPage).mockResolvedValueOnce({ page: { items: [placeRow("P2", "Decatur")], next_after: null }, totalCount: 1 });
    await store.runQuery("like(title, '%Dec%')", false);
    expect(store.hasWholeTreeRows()).toBe(true);

    vi.mocked(fetchPage).mockResolvedValueOnce({
      page: { items: [placeRow("P1", "Rush County"), placeRow("P2", "Decatur County")], next_after: null }, totalCount: 2,
    });
    await store.applyLiveChangesFiltered([
      { table: "place", handle: "P1", op: "UPDATE", changedBy: null },
      { table: "place", handle: "P2", op: "UPDATE", changedBy: null },
    ]);

    expect(store.readRowByHandle("P1", ["title"], { unfiltered: true })).toEqual(["Rush County"]);
    expect(store.readRowByHandle("P2", ["title"])).toEqual(["Decatur County"]);
    expect(store.readRowByHandle("P1", ["title"])).toBeNull();
    expect(store.getSnapshot().loadedCount).toBe(1);
  });
});

describe("ViewStore.applyColumnChange (Columns dialog)", () => {
  beforeEach(async () => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  });

  it("keeps showing the cached rows with the new column blank, then fills it from a refetch", async () => {
    const { setColumnLayout, applyColumnSettings } = await import("../columnSettings");
    const store = await loadedStore([tagRow("H1"), tagRow("H2")]);
    store.clearSelection();
    let resolvePage!: (value: Awaited<ReturnType<typeof fetchPage>>) => void;
    vi.mocked(fetchPage).mockReturnValueOnce(new Promise((resolve) => (resolvePage = resolve)));

    setColumnLayout("tag", { custom: [{ id: "goql_t", expr: "len(backlinks)" }], order: [], hidden: [] });
    const done = store.applyColumnChange();
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    const keyIndex = TAG_VIEW.columns.findIndex((c) => c.key === "goql_t");
    expect(keyIndex).toBeGreaterThan(-1);
    expect(store.getRows(0, 2).map((row) => row[keyIndex])).toEqual([null, null]);

    resolvePage({ page: { items: [tagRow("H1", { goql_t: 4 }), tagRow("H2", { goql_t: 0 })], next_after: null }, totalCount: 2 });
    await done;
    await vi.waitFor(() => expect(store.getRows(0, 2).map((row) => row[keyIndex])).toEqual(["4", "0"]));

    setColumnLayout("tag", null);
    applyColumnSettings(TAG_VIEW);
  });

  it("refetches nothing when only order or visibility changed", async () => {
    const { setColumnLayout } = await import("../columnSettings");
    const store = await loadedStore([tagRow("H1")]);
    setColumnLayout("tag", { custom: [], order: ["color", "name"], hidden: ["priority"] });
    await store.applyColumnChange();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    setColumnLayout("tag", null);
  });
});

describe("ViewStore sorting by a custom column", () => {
  const EXPR = "len(backlinks)";

  beforeEach(async () => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    const { setColumnLayout, applyColumnSettings } = await import("../columnSettings");
    setColumnLayout("tag", { custom: [{ id: "goql_t", expr: EXPR }], order: [], hidden: [] });
    applyColumnSettings(TAG_VIEW);
  });

  afterEach(async () => {
    const { setColumnLayout, applyColumnSettings } = await import("../columnSettings");
    setColumnLayout("tag", null);
    applyColumnSettings(TAG_VIEW);
  });

  function lastRankExpr(): string {
    const exprs = vi.mocked(fetchPage).mock.calls.map((call) => call[4] as string).filter((expr) => expr?.includes("handle <"));
    return exprs[exprs.length - 1];
  }

  async function sortedStore(): Promise<ViewStore> {
    vi.mocked(fetchPage).mockResolvedValue({ page: { items: [tagRow("H1", { goql_t: 2 })], next_after: null }, totalCount: 1 });
    const store = new ViewStore(TAG_VIEW, getSql);
    await store.runQuery(null, false);
    await store.setSort(EXPR);
    expect(store.getSnapshot().orderBy).toEqual({ column: EXPR, direction: "asc" });
    return store;
  }

  it("ranks a value after every missing one, compared as a number", async () => {
    const store = await sortedStore();
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H1", { goql_t: 3 }));
    await store.applyLiveChange({ table: "tag", handle: "H1", op: "UPDATE", changedBy: null });
    expect(lastRankExpr()).toContain(`(${EXPR} is None or ${EXPR} < 3)`);
    // Ties fall back to the list's default order (name), then handle.
    expect(lastRankExpr()).toContain(`${EXPR} == 3 and name < "Chores"`);
    expect(lastRankExpr()).toContain(`${EXPR} == 3 and name == "Chores" and handle < "H1"`);
  });

  it("ranks a missing value only among the other missing ones", async () => {
    const store = await sortedStore();
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H1", { goql_t: null }));
    await store.applyLiveChange({ table: "tag", handle: "H1", op: "UPDATE", changedBy: null });
    expect(lastRankExpr()).toBe(
      `(${EXPR} is None and name < "Chores") or (${EXPR} is None and name == "Chores" and handle < "H1")`,
    );
  });

  it("goes back to the default order when the list grows past the limit", async () => {
    const { SORT_ROW_LIMIT } = await import("../columnSettings");
    const store = await sortedStore();
    vi.mocked(fetchPage).mockResolvedValue({ page: { items: [], next_after: null }, totalCount: SORT_ROW_LIMIT + 1 });
    await store.applyWhereExpr('name == "x"');
    expect(store.getSnapshot().orderBy).toEqual({ column: "name", direction: "asc" });
    // No query sorted that many rows by the custom column.
    const sortedCalls = vi.mocked(fetchPage).mock.calls.filter((call) =>
      (call[5] as { column: string }[] | undefined)?.some((o) => o.column === EXPR),
    );
    expect(sortedCalls.every((call) => (call[4] as string | null) !== 'name == "x"')).toBe(true);
  });

  it("goes back to the default order when its column is removed", async () => {
    const { setColumnLayout } = await import("../columnSettings");
    const store = await sortedStore();
    setColumnLayout("tag", null);
    await store.applyColumnChange();
    expect(store.getSnapshot().orderBy).toEqual({ column: "name", direction: "asc" });
  });
});

describe("ViewStore sorting by a built-in date", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  function eventRow(handle: string, sortval: number | null) {
    return { handle, gramps_id: handle, date: sortval === null ? null : { _class: "Date", sortval, dateval: [0, 0, 1900, false] } };
  }

  async function sortedByDate(): Promise<ViewStore> {
    vi.mocked(fetchPage).mockResolvedValue({ page: { items: [eventRow("E1", 2415021)], next_after: null }, totalCount: 1 });
    const store = new ViewStore(EVENT_VIEW, getSql);
    await store.runQuery(null, false);
    await store.setSort("date.sortval");
    expect(store.getSnapshot().orderBy).toEqual({ column: "date.sortval", direction: "asc" });
    return store;
  }

  function lastRankExpr(): string {
    const exprs = vi.mocked(fetchPage).mock.calls.map((call) => call[4] as string).filter((expr) => expr?.includes("handle <"));
    return exprs[exprs.length - 1];
  }

  it("ranks by the sortval read from inside the cached date", async () => {
    const store = await sortedByDate();
    vi.mocked(fetchByHandle).mockResolvedValueOnce(eventRow("E1", 2415021));
    await store.applyLiveChange({ table: "event", handle: "E1", op: "UPDATE", changedBy: null });
    // Ties by description (the Date column's thenBy), then the default
    // order (gramps_id), then handle.
    expect(lastRankExpr()).toBe(
      '((date.sortval is None or date.sortval < 2415021)) or (date.sortval == 2415021 and description < "") or ' +
        '(date.sortval == 2415021 and description == "" and gramps_id < "E1") or ' +
        '(date.sortval == 2415021 and description == "" and gramps_id == "E1" and handle < "E1")',
    );
  });

  it("ranks an event with no date first", async () => {
    const store = await sortedByDate();
    vi.mocked(fetchByHandle).mockResolvedValueOnce(eventRow("E1", null));
    await store.applyLiveChange({ table: "event", handle: "E1", op: "UPDATE", changedBy: null });
    expect(lastRankExpr()).toBe(
      '(date.sortval is None and description < "") or (date.sortval is None and description == "" and gramps_id < "E1") or ' +
        '(date.sortval is None and description == "" and gramps_id == "E1" and handle < "E1")',
    );
  });

  it("doesn't sort a list over the limit by date", async () => {
    const { SORT_ROW_LIMIT } = await import("../views");
    const store = await sortedByDate();
    vi.mocked(fetchPage).mockResolvedValue({ page: { items: [], next_after: null }, totalCount: SORT_ROW_LIMIT + 1 });
    await store.applyWhereExpr('description == "x"');
    expect(store.getSnapshot().orderBy).toEqual({ column: "gramps_id", direction: "asc" });
  });
});

describe("ViewStore sorting by a custom name column", () => {
  const NAME = "father.primary_name";
  const SURNAME = `${NAME}.surname_list[0].surname`;
  const GIVEN = `${NAME}.first_name`;

  beforeEach(async () => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    const { setColumnLayout, applyColumnSettings } = await import("../columnSettings");
    setColumnLayout("family", { custom: [{ id: "goql_f", expr: NAME }], order: [], hidden: [] });
    applyColumnSettings(FAMILY_VIEW);
  });

  afterEach(async () => {
    const { setColumnLayout, applyColumnSettings } = await import("../columnSettings");
    setColumnLayout("family", null);
    applyColumnSettings(FAMILY_VIEW);
  });

  function familyRow(handle: string, father: { surname: string; given: string } | null) {
    const name = father && { _class: "Name", first_name: father.given, surname_list: [{ surname: father.surname }] };
    // The built-in Father column reads the same name (and sorts by the same
    // keys), so the server returns it under both.
    return { handle, gramps_id: handle, father_name: name, goql_f: name };
  }

  function lastRankExpr(): string {
    const exprs = vi.mocked(fetchPage).mock.calls.map((call) => call[4] as string).filter((expr) => expr?.includes("handle <"));
    return exprs[exprs.length - 1];
  }

  it("sorts by surname then given name, both at the clicked direction", async () => {
    vi.mocked(fetchPage).mockResolvedValue({ page: { items: [familyRow("F1", null)], next_after: null }, totalCount: 1 });
    const store = new ViewStore(FAMILY_VIEW, getSql);
    await store.runQuery(null, false);
    await store.setSort(SURNAME);
    const orderBy = vi.mocked(fetchPage).mock.calls[vi.mocked(fetchPage).mock.calls.length - 1][5];
    expect(orderBy).toEqual([
      { column: SURNAME, direction: "asc" }, { column: GIVEN, direction: "asc" }, { column: "gramps_id", direction: "asc" },
    ]);

    vi.mocked(fetchByHandle).mockResolvedValueOnce(familyRow("F1", { surname: "Smith", given: "Ann" }));
    await store.applyLiveChange({ table: "family", handle: "F1", op: "UPDATE", changedBy: null });
    expect(lastRankExpr()).toBe(
      `((${SURNAME} is None or ${SURNAME} < "Smith")) or ` +
        `(${SURNAME} == "Smith" and (${GIVEN} is None or ${GIVEN} < "Ann")) or ` +
        `(${SURNAME} == "Smith" and ${GIVEN} == "Ann" and gramps_id < "F1") or ` +
        `(${SURNAME} == "Smith" and ${GIVEN} == "Ann" and gramps_id == "F1" and handle < "F1")`,
    );
  });
});

describe("ViewStore re-sorting after a linked record changes", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
  });

  async function peopleStore(): Promise<ViewStore> {
    vi.mocked(fetchPage).mockResolvedValue({
      page: { items: [personRow("P1", { event_refs: [{ ref: "E1" }] }), personRow("P2", { event_refs: [{ ref: "E2" }] })], next_after: null },
      totalCount: 2,
    });
    const store = new ViewStore(PERSON_VIEW, getSql);
    await store.runQuery(null, false);
    return store;
  }

  it("refetches the list when sorted by birth date and a birth event changes", async () => {
    const store = await peopleStore();
    await store.setSort("birth.date.sortval");
    expect(await store.refreshDependents("event", ["E1"])).toBe("requery");
  });

  it("only patches the row in the default (name) order", async () => {
    const store = await peopleStore();
    expect(await store.refreshDependents("event", ["E1"])).toBe("patched");
  });
});

describe("ViewStore.ensureLoaded", () => {
  beforeEach(() => {
    vi.mocked(fetchPage).mockReset();
  });

  it("shares one load between calls made while it is still loading, instead of restarting it", async () => {
    // Regression: an effect keyed on the store's revision (usePeople)
    // called ensureLoaded() again on every emit while the first page was
    // still on its way; each call started a new runQuery that superseded
    // the last, so the list never finished loading and memory ran out.
    let resolvePage!: (value: Awaited<ReturnType<typeof fetchPage>>) => void;
    vi.mocked(fetchPage).mockReturnValueOnce(new Promise((resolve) => { resolvePage = resolve; }));
    const store = new ViewStore(TAG_VIEW, getSql);
    const calls = [store.ensureLoaded()];
    const unsubscribe = store.subscribe(() => {
      if (calls.length < 5) calls.push(store.ensureLoaded());
    });
    calls.push(store.ensureLoaded(), store.ensureLoaded());
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));
    resolvePage({ page: { items: [tagRow("H1"), tagRow("H2")], next_after: null }, totalCount: 2 });
    await Promise.all(calls);
    unsubscribe();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().loadedCount).toBe(2);
  });
});

describe("ViewStore sorting by a custom column with a \"then by\"", () => {
  const EXPR = "len(backlinks)";

  beforeEach(async () => {
    vi.mocked(fetchPage).mockReset();
    vi.mocked(fetchByHandle).mockReset();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    const { setColumnLayout, applyColumnSettings } = await import("../columnSettings");
    setColumnLayout("tag", { custom: [{ id: "goql_t", expr: EXPR, thenBy: "priority" }], order: [], hidden: [] });
    applyColumnSettings(TAG_VIEW);
  });

  afterEach(async () => {
    const { setColumnLayout, applyColumnSettings } = await import("../columnSettings");
    setColumnLayout("tag", null);
    applyColumnSettings(TAG_VIEW);
  });

  it("sorts by the column, then the \"then by\", then the default order, and ranks the same way", async () => {
    vi.mocked(fetchPage).mockResolvedValue({ page: { items: [tagRow("H1", { goql_t: 2 })], next_after: null }, totalCount: 1 });
    const store = new ViewStore(TAG_VIEW, getSql);
    await store.runQuery(null, false);
    await store.setSort(EXPR);
    await store.setSort(EXPR); // reversed: the tiebreaks follow
    const orderBy = vi.mocked(fetchPage).mock.calls[vi.mocked(fetchPage).mock.calls.length - 1][5];
    expect(orderBy).toEqual([
      { column: EXPR, direction: "desc" }, { column: "priority", direction: "desc" }, { column: "name", direction: "desc" },
    ]);

    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H1", { goql_t: 3, priority: 4 }));
    await store.applyLiveChange({ table: "tag", handle: "H1", op: "UPDATE", changedBy: null });
    const rank = vi.mocked(fetchPage).mock.calls.map((call) => call[4] as string).filter((e) => e?.includes("handle <")).pop();
    expect(rank).toContain(`${EXPR} == 3 and priority > 4`);
    expect(rank).toContain(`${EXPR} == 3 and priority == 4 and name > "Chores"`);
  });
});
