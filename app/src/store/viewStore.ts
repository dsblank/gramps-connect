// One instance per ViewConfig: owns that view's local sql.js cache, its
// OPFS persistence, background page fill, and live-sync patching. Ported
// from the original Layer 2/3 spike's browser.ts (module-level viewStates
// Map + runQuery/ensureViewLoaded/applyLiveChange; since removed, see git
// history), restructured as a class exposing subscribe()/getSnapshot()
// (see ../hooks/useViewStore.ts, a useSyncExternalStore wrapper) instead
// of imperative DOM updates.
//
// Row data itself is deliberately *not* part of the reactive snapshot --
// getRows()/getRowState() are called synchronously and imperatively during
// render (a pull, not a push), same as the original's renderVisible().
import type { Database, SqlJsStatic } from "sql.js";
import { getToken } from "../auth/auth";
import { fetchByHandle, fetchPage } from "./api";
import { loadFromOpfs, saveToOpfs, clearOpfs } from "./opfs";
import { createTableSql, insertSql, upsertSql, toRowValues } from "./sql";
import type { OrderBy, ViewConfig } from "./views";
import type { TreeChangeNotification } from "./liveSync";

export type RowState = "unloaded" | "loading" | "loaded";
export type ViewStatus = "idle" | "loading" | "ready" | "error";

export interface ViewSnapshot {
  loadedCount: number;
  totalCount: number;
  whereExpr: string | null;
  /** Current sort -- always populated (defaults to the view's static
   * orderBy, see ViewConfig.orderBy's doc comment), and shown in the UI
   * as such from the very first render, not just after a click. That's
   * what lets DataTable's header just read this one value: a column
   * whose two-click round trip (asc -> desc -> asc) happens to land back
   * on the view's default column+direction is showing the same,
   * correctly-labeled arrow the whole time, not silently reverting to an
   * unmarked-looking state. */
  orderBy: OrderBy;
  status: ViewStatus;
  error: string | null;
  /** Bumped on every emit(), including an in-place live-sync UPDATE that
   * leaves loadedCount/totalCount unchanged -- callers that cache windowed
   * row reads (see DataTable.tsx's useMemo) must key on this too, not just
   * loadedCount, or a same-count row patch silently never re-renders. */
  revision: number;
  /** The clicked row's index and handle, for DetailPanel -- kept here
   * (rather than as component-local state in DataTable) so a sibling
   * component can read the same selection without prop-drilling through
   * App.tsx. Cleared on a fresh runQuery() (see there) since a new
   * where_expr/sort means the old index no longer names the same row. */
  selectedIndex: number | null;
  selectedHandle: string | null;
}

const EMPTY_SNAPSHOT_BASE = {
  loadedCount: 0,
  totalCount: 0,
  whereExpr: null,
  status: "idle" as const,
  error: null,
  revision: 0,
  selectedIndex: null,
  selectedHandle: null,
};

export class ViewStore {
  readonly view: ViewConfig;
  private getSql: () => Promise<SqlJsStatic>;
  private db: Database | null = null;
  private loadedCount = 0;
  private totalCount = 0;
  private whereExpr: string | null = null;
  /** Current sort actually sent to the server -- defaults to the view's
   * static default, changed only via setSort(). Kept separate from
   * view.orderBy (which stays the immutable default to fall back to) so
   * each view's sort choice is independent per-instance state, same
   * treatment as whereExpr. An array (fetchPage's order_by is technically
   * a list) but this app only ever sorts by one column, so index 0 is the
   * only element and the only one the snapshot bothers exposing. */
  private orderBy: OrderBy[];
  private status: ViewStatus = "idle";
  private error: string | null = null;
  /** Bumped on every runQuery() call; a stale in-flight background fill
   * checks this and bails out rather than clobbering a newer query's state
   * once the caller has moved on to a different where_expr (or away from
   * this view entirely). */
  private queryGeneration = 0;
  private revision = 0;
  private selectedIndex: number | null = null;
  private selectedHandle: string | null = null;
  /** See navigateToHandle()'s doc comment -- true only while it's using
   * runQuery() purely to drop whereExpr, not as a real filter change. */
  private suppressSelectionClear = false;
  private listeners = new Set<() => void>();
  private snapshot: ViewSnapshot;

  constructor(view: ViewConfig, getSql: () => Promise<SqlJsStatic>) {
    this.view = view;
    this.getSql = getSql;
    this.orderBy = view.orderBy;
    this.snapshot = { ...EMPTY_SNAPSHOT_BASE, orderBy: view.orderBy[0] };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ViewSnapshot => this.snapshot;

  private emit() {
    this.revision += 1;
    this.snapshot = {
      loadedCount: this.loadedCount,
      totalCount: this.totalCount,
      whereExpr: this.whereExpr,
      orderBy: this.orderBy[0],
      status: this.status,
      error: this.error,
      revision: this.revision,
      selectedIndex: this.selectedIndex,
      selectedHandle: this.selectedHandle,
    };
    for (const listener of this.listeners) listener();
  }

  getRowState(index: number): RowState {
    if (!this.db) return "unloaded";
    return index < this.loadedCount ? "loaded" : "loading";
  }

  /** Records which row DataTable's click handler landed on, for DetailPanel
   * to pick up via the snapshot. Looks the handle up with the same
   * order/direction as getRows() so it names the same row the user
   * actually clicked, not whatever happens to be at that offset under the
   * default order. */
  select(index: number): void {
    if (!this.db) return;
    this.selectedIndex = index;
    this.selectedHandle = this.getHandleAt(index);
    this.emit();
  }

  /** Drops the current selection -- used when history navigation (see
   * useHistorySync.ts) lands on a view-only URL (no handle segment), so
   * DetailPanel reverts to its "select a row" placeholder instead of still
   * showing whatever was selected before. */
  clearSelection(): void {
    if (this.selectedIndex === null && this.selectedHandle === null) return;
    this.selectedIndex = null;
    this.selectedHandle = null;
    this.emit();
  }

  /** Selects an (index, handle) pair the caller already knows to be
   * correct -- unlike select(), doesn't re-derive the handle from the
   * local cache at that index. Used by navigateToHandle(), which computes
   * both authoritatively via a server round trip; the local cache may not
   * have reached that far yet (see its own doc comment). */
  private selectAt(index: number, handle: string): void {
    this.selectedIndex = index;
    this.selectedHandle = handle;
    this.emit();
  }

  /** Jumps to `handle`'s row -- e.g. a person link in PersonDetail's
   * parents/family sections -- regardless of whether the local cache has
   * loaded that far yet. Drops any active where_expr first: a linked
   * record isn't guaranteed to match it (and the point of following a
   * link is to see that record, not to have it silently fail to appear).
   * Returns false if the handle doesn't resolve to a row at all (a
   * dangling reference), true once selection has moved to it. */
  async navigateToHandle(handle: string): Promise<boolean> {
    if (this.whereExpr !== null) {
      // runQuery() unconditionally nulls out the selection at its start --
      // right for its other callers (the user directly typing/clearing a
      // filter, where "no selection yet in the new results" is a real,
      // observable state), wrong here: this call is purely an internal
      // step to get whereExpr out of the way before re-selecting a few
      // lines down, and that transient null must never be observed
      // in between -- useHistorySync.ts mirrors selectedHandle into the
      // URL on every change, so an observed-then-reverted null would
      // wrongly commit an extra "no selection" entry to browser history.
      this.suppressSelectionClear = true;
      try {
        await this.runQuery(null, false);
      } finally {
        this.suppressSelectionClear = false;
      }
    }
    const index = await this.findGlobalIndex(handle);
    if (index === null) return false;
    this.selectAt(index, handle);
    return true;
  }

  /** The exact 0-based row index `handle` occupies under the view's
   * current sort, straight from the server -- a single count-only query
   * for "rows that sort before this one" (X-Total-Count *is* that count).
   * Deliberately not computed by ranking within the local cache: that only
   * knows about whatever the background fill has reached so far (see
   * runQuery), which for a target near the end of a still-filling dataset
   * would rank it far too early. */
  private async findGlobalIndex(handle: string): Promise<number | null> {
    const token = await getToken();
    const item = await fetchByHandle(this.view, token, handle);
    if (!item) return null;

    const orderCol = this.orderBy[0]?.column ?? "handle";
    const desc = this.orderBy[0]?.direction === "desc";
    const cmp = desc ? ">" : "<";
    // where_expr is parsed as a Python expression (see
    // gramps-object-query-language's query_lang.py) -- JSON's string
    // escaping is a safe subset of Python's, so JSON.stringify doubles as
    // a correct, injection-safe Python string literal here.
    const sqlType = this.view.columns.find((c) => c.key === orderCol)?.sqlType;
    const literal = (value: unknown) =>
      sqlType === "INTEGER" ? String(value) : JSON.stringify(String(value ?? ""));
    const orderValue = item[orderCol];
    // Same tie-break as getRows()/getHandleAt(): the server's own
    // effective_order_by always appends `OrderBy("handle", "asc")", so
    // "before" has to mean "before in (orderCol, handle) order", not just
    // "orderCol is less".
    const beforeExpr =
      `(${orderCol} ${cmp} ${literal(orderValue)}) or ` +
      `(${orderCol} == ${literal(orderValue)} and handle ${cmp} ${JSON.stringify(item.handle)})`;
    const { totalCount } = await fetchPage(this.view, token, null, true, beforeExpr, this.orderBy, 1);
    return totalCount;
  }

  private getHandleAt(index: number): string | null {
    if (!this.db) return null;
    const orderCol = this.orderBy[0]?.column ?? "handle";
    const direction = this.orderBy[0]?.direction === "desc" ? "DESC" : "ASC";
    const res = this.db.exec(
      `SELECT handle FROM ${this.view.key} ORDER BY ${orderCol} ${direction}, handle ASC LIMIT 1 OFFSET ?;`,
      [index]
    );
    return (res[0]?.values[0]?.[0] as string | undefined) ?? null;
  }

  /** Windowed read against the local cache, mirroring the original
   * renderVisible()'s single LIMIT/OFFSET query per scroll frame -- one
   * query for the whole visible range rather than one per row. Returns raw
   * column values in view.columns order; callers apply each column's
   * toDisplay themselves. */
  getRows(startIndex: number, count: number): unknown[][] {
    if (!this.db) return [];
    const orderCol = this.orderBy[0]?.column ?? "handle";
    // The actual bug behind "sort direction doesn't seem to do anything":
    // this ORDER BY never carried a direction keyword at all, so SQLite's
    // implicit default (ASC) applied no matter what this.orderBy said --
    // clicking a header changed the arrow and what got requested from the
    // server, but not what got displayed. `handle`'s own direction stays
    // ASC regardless of the primary column's, matching the server's own
    // tie-break (effective_order_by in gramps-object-query-language always
    // appends `OrderBy("handle", "asc")`, independent of the requested
    // column's direction) -- local reads need to agree with that ordering
    // for the windowed LIMIT/OFFSET reads to land on the same rows the
    // server's keyset pagination did.
    const direction = this.orderBy[0]?.direction === "desc" ? "DESC" : "ASC";
    const res = this.db.exec(
      `SELECT ${this.view.columns.map((c) => c.key).join(", ")} FROM ${this.view.key} ` +
      `ORDER BY ${orderCol} ${direction}, handle ASC LIMIT ? OFFSET ?;`,
      [count, startIndex]
    );
    return res[0]?.values ?? [];
  }

  /** Loads this view's cache if it hasn't been loaded yet this session
   * (OPFS, falling back to a fresh fetch); a no-op if already loaded --
   * the caller just reads the current snapshot/rows. */
  async ensureLoaded(): Promise<void> {
    if (this.db) return;

    const cached = await loadFromOpfs(this.view.opfsFilename);
    if (cached) {
      try {
        const SQL = await this.getSql();
        const db = new SQL.Database(cached);
        // A stale OPFS cache from before a schema change would otherwise
        // throw deep inside getRows(), uncaught -- treat any mismatch as
        // "not cached" and fall through to a fresh fetch.
        db.exec(`SELECT ${this.view.columns.map((c) => c.key).join(", ")} FROM ${this.view.key} LIMIT 1;`);
        this.db = db;
        this.totalCount = this.loadedCount = Number(db.exec(`SELECT COUNT(*) FROM ${this.view.key};`)[0].values[0][0]);
        this.whereExpr = null;
        this.orderBy = this.view.orderBy;
        this.status = "ready";
        this.emit();
        return;
      } catch {
        await clearOpfs(this.view.opfsFilename);
      }
    }
    // Establishing the view for the first time this session, under its
    // default order/no filter -- never a reason to invalidate a selection,
    // unlike runQuery()'s other callers (see suppressSelectionClear's other
    // use in navigateToHandle()). Matters when this view hasn't been
    // activated yet and useHistorySync's applyHash() is jumping straight to
    // a row in it (e.g. a person link's Event line): its navigateToHandle()
    // call and App.tsx's ensureLoaded() effect both fire off the activeKey
    // change, and without this guard, whichever finishes first (usually
    // navigateToHandle, a couple of lightweight queries vs. a first-page
    // fetch) gets its selection wiped by the other moments later.
    this.suppressSelectionClear = true;
    try {
      await this.runQuery(null, true);
    } finally {
      this.suppressSelectionClear = false;
    }
  }

  /** Fetches a fresh (optionally where_expr-filtered) copy of this view's
   * object list from scratch. Page one sets the total count and makes the
   * cache queryable; everything past page one fills in detached, in the
   * background. Only an unfiltered result persists to OPFS -- a filtered
   * result isn't "the dataset", so it shouldn't overwrite that cache. */
  async runQuery(whereExpr: string | null, persist: boolean): Promise<void> {
    const myGeneration = ++this.queryGeneration;
    // Captured once per call, not read fresh off `this.orderBy` later --
    // a setSort() during this query's background fill bumps
    // queryGeneration and starts its own runQuery, so this one's own
    // fetchPage calls should keep using the orderBy it started with
    // rather than picking up the newer one mid-flight.
    const orderBy = this.orderBy;
    this.status = "loading";
    this.error = null;
    // A new where_expr or sort invalidates the old index/handle pairing
    // (see ViewSnapshot.selectedIndex's doc comment) -- same "reset rather
    // than carry stale state forward" treatment runQuery already gives
    // loadedCount/totalCount. Skipped when navigateToHandle() is only using
    // this call to drop whereExpr on its way to re-selecting -- see its own
    // doc comment on suppressSelectionClear.
    if (!this.suppressSelectionClear) {
      this.selectedIndex = null;
      this.selectedHandle = null;
    }
    this.emit();

    let token: string;
    try {
      token = await getToken();
    } catch (err: any) {
      if (myGeneration !== this.queryGeneration) return;
      this.status = "error";
      this.error = err.message ?? String(err);
      this.emit();
      throw err;
    }

    const SQL = await this.getSql();
    const newDb = new SQL.Database();
    newDb.run(createTableSql(this.view));
    const stmt = newDb.prepare(insertSql(this.view));

    let after: string | null = null;
    let first;
    try {
      first = await fetchPage(this.view, token, after, true, whereExpr, orderBy);
    } catch (err: any) {
      stmt.free();
      if (myGeneration !== this.queryGeneration) return;
      this.status = "error";
      this.error = err.message ?? String(err);
      this.emit();
      throw err;
    }
    if (myGeneration !== this.queryGeneration) {
      stmt.free();
      return; // superseded by a newer query while this was in flight
    }

    this.db = newDb;
    this.totalCount = first.totalCount ?? 0;
    this.whereExpr = whereExpr;
    this.insertPage(newDb, stmt, first.page.items);
    this.loadedCount = first.page.items.length;
    after = first.page.next_after;
    this.status = "ready";
    this.emit();

    (async () => {
      while (after !== null) {
        const { page } = await fetchPage(this.view, await getToken(), after, false, whereExpr, orderBy);
        if (myGeneration !== this.queryGeneration) {
          stmt.free();
          return;
        }
        this.insertPage(newDb, stmt, page.items);
        this.loadedCount += page.items.length;
        after = page.next_after;
        this.emit();
      }
      stmt.free();

      if (persist && myGeneration === this.queryGeneration) {
        await saveToOpfs(this.view.opfsFilename, newDb.export());
      }
    })().catch((err) => {
      // Background-fill failure only gets logged -- by this point the
      // caller (runQuery's own awaiters) has already moved on.
      console.error(`[${this.view.label}] background fill error`, err);
    });
  }

  /** Sorts by `column` (a plain-column ColumnConfig.select value -- see
   * ViewConfig.orderBy's doc comment on why json_path columns can never
   * reach here), toggling asc/desc on a repeat click of the same column
   * -- including the view's own default column, which starts out already
   * "asc" (see ViewSnapshot.orderBy's doc comment on why the header shows
   * that from the first render rather than hiding it: the arrow stays
   * accurate through the whole asc -> desc -> asc round trip, so landing
   * back on the default's column+direction reads as "still ascending",
   * not as a mystery revert). Re-runs the current where_expr from scratch
   * against the new order (keyset pagination is order-dependent, so this
   * can't just re-sort already-loaded rows -- same "reset and refill"
   * path a filter change already takes, not a new one, and for the same
   * reason: DataTable's virtualizer keys off loadedCount/totalCount
   * either way, so this transition is exactly as jitter-free as applying
   * a filter already is). */
  setSort(column: string): Promise<void> {
    const current = this.orderBy[0];
    const direction: "asc" | "desc" =
      current?.column === column && current.direction === "asc" ? "desc" : "asc";
    this.orderBy = [{ column, direction }];
    return this.runQuery(this.whereExpr, false);
  }

  private insertPage(db: Database, stmt: ReturnType<Database["prepare"]>, items: Parameters<typeof toRowValues>[1][]) {
    db.run("BEGIN TRANSACTION;");
    for (const item of items) {
      stmt.run(toRowValues(this.view, item));
    }
    db.run("COMMIT;");
  }

  /** Patches this view's already-loaded, unfiltered cache in place for one
   * live-sync notification. Call only after liveSync.ts's
   * shouldApplyNotification() guard has passed (treeid/table/whereExpr
   * checks) -- this method only guards on cache readiness. A DELETE
   * removes the row locally; INSERT/UPDATE both refetch the row fresh from
   * the server (the notification itself carries no data) and upsert it. */
  async applyLiveChange(notification: TreeChangeNotification): Promise<void> {
    if (!this.db) return;

    const existed = (this.db.exec(`SELECT 1 FROM ${this.view.key} WHERE handle = ?;`, [notification.handle])[0]?.values.length ?? 0) > 0;

    if (notification.op === "DELETE") {
      if (!existed) return;
      this.db.run(`DELETE FROM ${this.view.key} WHERE handle = ?;`, [notification.handle]);
      this.loadedCount -= 1;
      this.totalCount -= 1;
    } else {
      const token = await getToken();
      const item = await fetchByHandle(this.view, token, notification.handle);
      if (!item) return; // deleted again before the refetch landed
      const stmt = this.db.prepare(upsertSql(this.view));
      stmt.run(toRowValues(this.view, item));
      stmt.free();
      if (!existed) {
        this.loadedCount += 1;
        this.totalCount += 1;
      }
    }

    this.emit();
  }
}
