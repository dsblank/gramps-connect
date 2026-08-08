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
  return { table: "tag", handle, op };
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

    await store.applyLiveChange(notification("H1", "UPDATE"));

    expect(fetchByHandle).toHaveBeenCalledWith(TAG_VIEW, "test-token", "H1");
    expect(store.getRows(0, 10)).toEqual([["New", "#ff0000", 1, 1000]]);
    expect(store.getSnapshot().loadedCount).toBe(1);
    expect(store.getSnapshot().totalCount).toBe(1);
  });

  it("UPDATE/INSERT of a handle not yet in the cache adds it and increments both counts", async () => {
    const store = await loadedStore([tagRow("H1")]);
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H2", { name: "Brand new" }));

    await store.applyLiveChange(notification("H2", "INSERT"));

    expect(store.getSnapshot().loadedCount).toBe(2);
    expect(store.getSnapshot().totalCount).toBe(2);
    expect(store.getRows(0, 10).map((row) => row[0])).toEqual(
      expect.arrayContaining(["Chores", "Brand new"])
    );
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

    await store.applyLiveChange(notification("H1", "UPDATE"));

    expect(store.getSnapshot().revision).toBe(revisionAfterLoad + 1);
  });

  it("bumps selectedRevision when the change matches the currently selected handle", async () => {
    const store = await loadedStore([tagRow("H1")]);
    store.select(0); // H1, the only row -- see getHandleAt()'s rowid ordering
    expect(store.getSnapshot().selectedHandle).toBe("H1");
    const selectedRevisionAfterSelect = store.getSnapshot().selectedRevision;
    vi.mocked(fetchByHandle).mockResolvedValueOnce(tagRow("H1", { color: "#00ff00" }));

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

    await store.applyLiveChange(notification("H2", "UPDATE"));

    // The table-wide revision still bumps (DataTable needs to re-render H2's row) ...
    expect(store.getSnapshot().revision).toBe(revisionAfterSelect + 1);
    // ... but selectedRevision, which only H1's own detail panel watches, must not.
    expect(store.getSnapshot().selectedRevision).toBe(selectedRevisionAfterSelect);
  });
});
