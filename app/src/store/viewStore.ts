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
import { fetchServerState, isCacheStale, updateCachedCursor, writeCacheMeta } from "./cacheMeta";
import { createTableSql, insertSql, updateSql, toRowValues, toUpdateRowValues } from "./sql";
import type { OrderBy, ViewConfig } from "./views";
import type { TreeChangeNotification } from "./historyPoll";

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
  /** True when the current selection is the one applied automatically
   * against a freshly loaded cache (see applyDefaultSelection) rather than
   * one the user actually clicked or navigated to. The detail panes read
   * the selection the same way either way -- this exists only so
   * useHistorySync.ts can keep a default selection *out* of the URL: a
   * default is by definition what any visit to this view already shows, so
   * mirroring it into the hash would both push a history entry the user
   * never asked for and make Back (which lands on the handle-less `#view`
   * route -- "no explicit selection") immediately bounce forward again. */
  selectionIsDefault: boolean;
  /** Bumped only when a live-sync notification's handle matches
   * selectedHandle -- unlike `revision` (bumped for any row in this
   * view), this lets a detail panel refetch when *its own* record
   * changes without also refetching every time some other, unrelated row
   * in the table is live-patched. See RelatedPanel.tsx's `revision`
   * prop, which is fed this instead of the table-wide `revision`. */
  selectedRevision: number;
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
  selectionIsDefault: false,
  selectedRevision: 0,
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
  private selectionIsDefault = false;
  private selectedRevision = 0;
  /** See navigateToHandle()'s doc comment -- true only while it's using
   * runQuery() purely to drop whereExpr, not as a real filter change. */
  private suppressSelectionClear = false;
  /** See requeryDebounced()'s doc comment. */
  private requeryTimer: ReturnType<typeof setTimeout> | null = null;
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
      selectionIsDefault: this.selectionIsDefault,
      selectedRevision: this.selectedRevision,
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
    this.selectionIsDefault = false;
    this.emit();
  }

  /** Bumps selectedRevision (the same signal applyLiveChange() sends a
   * live-synced edit of the selected row) without touching any cached row
   * data -- for a write that goes straight to the server via some other
   * path (useMediaDrop.ts attaching a dropped file directly to the viewed
   * record, bypassing the edit-dialog/draftStack flow entirely), so
   * RelatedPanel's own revision-keyed effect refetches this record's detail
   * immediately instead of waiting up to one live-sync poll interval.
   * No-op if `handle` isn't the current selection. */
  touchSelected(handle: string): void {
    if (handle !== this.selectedHandle) return;
    this.selectedRevision += 1;
    this.emit();
  }

  /** Selects the first row whenever nothing is selected against a loaded
   * cache, so the detail panes always have a record to show. An empty
   * right-hand pane is a dead half of the window, and the first row is
   * both the cheapest thing to show and the one the user would most
   * likely have clicked on arriving anyway. Called from every point a
   * selection can go null with rows present: a finished query (fresh
   * load, filter change, sort change), a live delete of the selected row
   * (reconcileSelection), and history navigation to a handle-less route
   * (clearSelection).
   *
   * Sets fields only, never emits -- every caller is already emitting in
   * the same pass for its own reasons. The result is flagged as a
   * *default* selection (see ViewSnapshot.selectionIsDefault) so it stays
   * out of the URL; only a real click or navigation puts a handle there. */
  private applyDefaultSelection(): void {
    if (!this.db || this.selectedIndex !== null || this.totalCount === 0) return;
    const handle = this.getHandleAt(0);
    if (handle === null) return; // totalCount > 0 but page one hasn't landed yet
    this.selectedIndex = 0;
    this.selectedHandle = handle;
    this.selectionIsDefault = true;
  }

  /** Drops an *explicit* selection -- used when history navigation (see
   * useHistorySync.ts) lands on a view-only URL (no handle segment).
   * Falls back to the default selection rather than to nothing at all:
   * a handle-less route means "whatever this view shows by default", and
   * that's now the first row, not a blank detail pane. Already being on
   * the default is therefore a no-op, not a reason to re-emit -- Back to a
   * view-only route would otherwise churn a snapshot on every press. */
  clearSelection(): void {
    if (this.selectionIsDefault) return;
    if (this.selectedIndex === null && this.selectedHandle === null) return;
    this.selectedIndex = null;
    this.selectedHandle = null;
    this.applyDefaultSelection();
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
    this.selectionIsDefault = false;
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
    return this.globalRankOfItem(item, token);
  }

  /** The 0-based rank `item` occupies among every row on the server under
   * the view's current sort (X-Total-Count of a "rows that sort before
   * this one" count-only query *is* that rank) -- the authoritative
   * position applyLiveChange() places a live-synced row at locally.
   * Deliberately never computed by comparing column values in SQLite
   * itself: this app's local cache and the server (Postgres) use
   * different collations, which can disagree on ties *and* on relative
   * order once non-ASCII text is involved (found live: "Gainesville, TX"
   * sorting differently from "Gainesville, GA" once Greek-lettered titles
   * were interleaved) -- only the server's own comparison is trustworthy
   * for real placement, not just an index lookup. Takes an already-fetched
   * item (rather than a handle) so applyLiveChange() -- which has already
   * called fetchByHandle() to get the row's fresh post-edit data -- isn't
   * forced into a second, redundant fetch just to re-derive it. */
  private async globalRankOfItem(item: Record<string, unknown> & { handle: string }, token: string): Promise<number> {
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
    // "orderCol is less". item's own row (same handle) never counts as
    // "before itself" under this tie-break, so this correctly excludes it.
    const beforeExpr =
      `(${orderCol} ${cmp} ${literal(orderValue)}) or ` +
      `(${orderCol} == ${literal(orderValue)} and handle ${cmp} ${JSON.stringify(item.handle)})`;
    // combinedFilter() re-applies this view's own baseFilter (if any) --
    // without it, a permanently-filtered view (e.g. Output) would
    // rank against every row of the underlying table, not just the subset
    // it actually shows.
    const { totalCount } = await fetchPage(this.view, token, null, true, this.combinedFilter(beforeExpr), this.orderBy, 1);
    return totalCount ?? 0;
  }

  private getHandleAt(index: number): string | null {
    if (!this.db) return null;
    const res = this.db.exec(
      `SELECT handle FROM ${this.view.key} ORDER BY rowid LIMIT 1 OFFSET ?;`,
      [index]
    );
    return (res[0]?.values[0]?.[0] as string | undefined) ?? null;
  }

  /** The Gramps ID of a cached row, by handle. Handles are what selection
   * is tracked by, but Gramps' report options identify records by Gramps
   * ID, so ReportDialog.tsx goes through here to pre-fill a report's
   * subject from whatever the user has selected. Null when this view has
   * no gramps_id column, hasn't loaded, or doesn't have that row cached --
   * all of which the caller treats the same way: no pre-fill. */
  grampsIdForHandle(handle: string): string | null {
    if (!this.db) return null;
    if (!this.view.columns.some((column) => column.key === "gramps_id")) return null;
    const res = this.db.exec(
      `SELECT gramps_id FROM ${this.view.key} WHERE handle = ?;`,
      [handle]
    );
    return (res[0]?.values[0]?.[0] as string | undefined) ?? null;
  }

  /** Windowed read against the local cache, mirroring the original
   * renderVisible()'s single LIMIT/OFFSET query per scroll frame -- one
   * query for the whole visible range rather than one per row. Returns raw
   * column values in view.columns order; callers apply each column's
   * toDisplay themselves.
   *
   * Reads back by `rowid` (SQLite's own implicit, insertion-order column)
   * rather than re-sorting by the order column, on purpose -- a fresh
   * `ORDER BY <textColumn>` here would re-derive an ordering using
   * SQLite's own (binary) collation, which doesn't necessarily agree with
   * the server's (Postgres, locale-aware) collation for the same column.
   * Two systems independently sorting the same text can disagree on ties
   * *and* on relative order once non-ASCII values are mixed in with ASCII
   * ones (found live: a `where` filter landing on the correct server-
   * computed row *index*, per findGlobalIndex(), but the row actually
   * rendered at that local offset was a different, similarly-named record
   * -- e.g. selecting "Gainesville, TX" highlighted "Gainesville, GA"
   * instead, because the two collations had drifted apart by that point
   * in the alphabet once titles with Greek characters were interleaved).
   * `rowid` sidesteps the whole problem: insertPage() below already writes
   * rows in exactly the order the server's own keyset-paginated query
   * returned them (that's what pagination *is*), asc or desc alike, so
   * reading them back by rowid reproduces the server's order exactly, with
   * no local re-sort -- and no collation to keep in sync -- at all.
   *
   * A live-synced INSERT or UPDATE doesn't just patch a row's data in
   * place, then: applyLiveChange() also asks the server for that row's
   * authoritative rank (globalRankOfItem() -- same server-collation
   * reasoning as above, since comparing the new value locally would
   * reintroduce exactly the drift this rowid scheme exists to avoid) and
   * moves it (repositionRow()) to that exact local slot, so a
   * sort-affecting edit is reflected correctly immediately, not just
   * "eventually, on the next full reload". selectedIndex is kept in sync
   * with whatever moves by reconcileSelection(), for the same reason. */
  getRows(startIndex: number, count: number): unknown[][] {
    if (!this.db) return [];
    const res = this.db.exec(
      `SELECT ${this.view.columns.map((c) => c.key).join(", ")} FROM ${this.view.key} ` +
      `ORDER BY rowid LIMIT ? OFFSET ?;`,
      [count, startIndex]
    );
    return res[0]?.values ?? [];
  }

  /** Whole-table read of just the named columns, for a consumer that needs
   * every cached row at once rather than a scroll window -- the Map and
   * Timeline (see store/visualData.ts), which plot the entire tree and so
   * have no viewport to page against.
   *
   * Deliberately *not* a general "run any SQL here" escape hatch: the
   * column names are spliced into the statement, so they're checked against
   * this view's own ColumnConfig keys first (`handle` too, which every
   * cache table has as its primary key but which isn't a ColumnConfig).
   * Unknown names throw rather than being dropped -- a caller asking for a
   * column this view doesn't cache has a bug, and silently returning short
   * rows would surface as undefined values far from the cause.
   *
   * Row *order* is the same server-derived rowid order as getRows(), which
   * neither caller depends on (both sort by their own axis -- coordinate,
   * date), but keeps the two reads consistent. Returns only what's cached:
   * against a partially filled view this is the loaded prefix, not the
   * whole tree -- callers watch loadedCount to know. */
  readColumns(columnKeys: string[]): unknown[][] {
    if (!this.db) return [];
    this.assertCachedColumns(columnKeys);
    const res = this.db.exec(
      `SELECT ${columnKeys.join(", ")} FROM ${this.view.key} ORDER BY rowid;`
    );
    return res[0]?.values ?? [];
  }

  /** One row's worth of the named columns, by handle, or null if this view
   * has no such row cached (not loaded yet, or only a prefix of the tree
   * filled so far -- callers can't tell those apart and mostly shouldn't
   * care; both mean "can't answer from here").
   *
   * The single-row counterpart to readColumns, for a caller that wants one
   * known record rather than the whole table -- visualScope.ts, resolving a
   * routed subject to its events. Scanning readColumns' whole-table result
   * for one handle would work and be O(rows); `handle` is the table's
   * PRIMARY KEY (see sql.ts's createTableSql), so this is an index lookup
   * instead. Same column-name guard, for the same reason: the names are
   * spliced into the statement. */
  readRowByHandle(handle: string, columnKeys: string[]): unknown[] | null {
    if (!this.db) return null;
    this.assertCachedColumns(columnKeys);
    const res = this.db.exec(
      `SELECT ${columnKeys.join(", ")} FROM ${this.view.key} WHERE handle = ?;`,
      [handle]
    );
    return res[0]?.values[0] ?? null;
  }

  /** Shared guard for the two whole-row readers above: the column names are
   * spliced into SQL, so they're checked against this view's own
   * ColumnConfig keys (plus `handle`, the primary key, which isn't one).
   * Unknown names throw rather than being dropped -- a caller asking for a
   * column this view doesn't cache has a bug, and silently returning short
   * rows would surface as undefined values far from the cause. */
  private assertCachedColumns(columnKeys: string[]): void {
    const known = new Set(["handle", ...this.view.columns.map((c) => c.key)]);
    const unknown = columnKeys.filter((key) => !known.has(key));
    if (unknown.length > 0) {
      throw new Error(`[${this.view.key}] not cached columns: ${unknown.join(", ")}`);
    }
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
        // A cache from before a *table* change would otherwise throw deep
        // inside getRows(), uncaught -- treat any mismatch as "not cached"
        // and fall through to a fresh fetch.
        db.exec(`SELECT ${this.view.columns.map((c) => c.key).join(", ")} FROM ${this.view.key} LIMIT 1;`);
        // Opening cleanly only proves the shape is right, not that the rows
        // still are: the server may have moved on (or be a different server
        // entirely) since this file was written. See cacheMeta.ts.
        const staleness = await isCacheStale(db, this.view);
        if (staleness.stale) {
          db.close();
          throw new Error("stale cache");
        }
        // Nothing touched this view's own table, but the tree-wide cursor
        // moved on regardless -- re-stamp so the next reload's fast path
        // (a plain cursor comparison) settles it without walking the same
        // already-cleared transaction range again. Not on the critical
        // path: the cache is already known good, so this can happen after
        // the view is visible.
        if (staleness.advanceCursorTo !== undefined) {
          updateCachedCursor(db, staleness.advanceCursorTo);
          saveToOpfs(this.view.opfsFilename, db.export()).catch((err) => {
            console.error(`[${this.view.label}] cursor-advance persist failed`, err);
          });
        }
        this.db = db;
        this.totalCount = this.loadedCount = Number(db.exec(`SELECT COUNT(*) FROM ${this.view.key};`)[0].values[0][0]);
        this.whereExpr = null;
        this.orderBy = this.view.orderBy;
        this.status = "ready";
        this.applyDefaultSelection();
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

  /** The where_expr actually sent to the server: `whereExpr` (the
   * user-editable part FilterBar drives, always null for a view with
   * `baseFilter` set -- see ViewConfig.searchable) AND-ed with the view's
   * own fixed `baseFilter`, if any. Kept separate from `this.whereExpr`
   * (which stays exactly what the user typed, or null) so the snapshot
   * FilterBar reads never shows the hidden fixed filter as if it were
   * user input. */
  private combinedFilter(whereExpr: string | null): string | null {
    const base = this.view.baseFilter ?? null;
    if (base && whereExpr) return `(${base}) and (${whereExpr})`;
    return base ?? whereExpr;
  }

  /** Fetches a fresh (optionally where_expr-filtered) copy of this view's
   * object list from scratch. Page one sets the total count and makes the
   * cache queryable; everything past page one fills in detached, in the
   * background. Only an unfiltered result persists to OPFS -- a filtered
   * result isn't "the dataset", so it shouldn't overwrite that cache.
   *
   * `preserveDisplayUntilCaughtUp`, set only by requeryDebounced(): a
   * live-sync full requery of an already-scrolled view (more than one page
   * loaded) would otherwise swap in a brand-new, page-one-only db the
   * moment page one lands -- loadedCount visibly drops back to one page's
   * worth (DataTable renders every row past it as a loading placeholder)
   * until the background fill claws its way back up, seconds later. Bug:
   * looked like the whole table "clearing" every time anything on the
   * live-synced table changed anywhere in the tree. With this set, the old
   * db/loadedCount keep serving reads until the new fetch has loaded at
   * least as many rows as were already showing (or finishes entirely),
   * then swaps in atomically -- same eventual data, no visible dip. */
  async runQuery(
    whereExpr: string | null,
    persist: boolean,
    options?: { preserveDisplayUntilCaughtUp?: boolean }
  ): Promise<void> {
    const preserve = options?.preserveDisplayUntilCaughtUp ?? false;
    const previousLoadedCount = this.loadedCount;
    const myGeneration = ++this.queryGeneration;
    // Captured once per call, not read fresh off `this.orderBy` later --
    // a setSort() during this query's background fill bumps
    // queryGeneration and starts its own runQuery, so this one's own
    // fetchPage calls should keep using the orderBy it started with
    // rather than picking up the newer one mid-flight.
    const orderBy = this.orderBy;
    // Kicked off (not awaited) before the first page is even requested, so
    // it costs no latency and, more importantly, describes the server as it
    // was *before* this fetch -- see writeCacheMeta()'s doc comment on why
    // capturing it after the fill would mark a cache as current with
    // changes it doesn't actually contain. Failure resolves to null rather
    // than rejecting: this is only needed on the persist path below.
    const serverStateAtStart = persist ? fetchServerState().catch(() => null) : null;
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
      this.selectionIsDefault = false;
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
      first = await fetchPage(this.view, token, after, true, this.combinedFilter(whereExpr), orderBy);
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

    const newTotalCount = first.totalCount ?? 0;
    this.insertPage(newDb, stmt, first.page.items);
    let loadedSoFar = first.page.items.length;
    after = first.page.next_after;
    let swapped = false;

    // Swaps the new db/counts in as the visible ones -- immediately after
    // page one for every ordinary call (preserve is false), or, when
    // preserving, only once loadedSoFar has caught back up to what was
    // already showing (see this method's own doc comment).
    const swapIn = () => {
      swapped = true;
      this.db = newDb;
      this.totalCount = newTotalCount;
      this.whereExpr = whereExpr;
      this.loadedCount = loadedSoFar;
      this.status = "ready";
      // Page one is what makes a default selection possible at all (it's
      // the first moment there's a row 0 to name) -- a no-op when
      // something is already selected, which covers both
      // suppressSelectionClear callers: navigateToHandle is mid-flight
      // toward a real selection here, and requeryDebounced is preserving
      // one across a live-sync reload.
      this.applyDefaultSelection();
    };

    if (!preserve || loadedSoFar >= previousLoadedCount || after === null) {
      swapIn();
      this.emit();
    }

    (async () => {
      while (after !== null) {
        const { page } = await fetchPage(this.view, await getToken(), after, false, this.combinedFilter(whereExpr), orderBy);
        if (myGeneration !== this.queryGeneration) {
          stmt.free();
          return;
        }
        this.insertPage(newDb, stmt, page.items);
        loadedSoFar += page.items.length;
        after = page.next_after;
        if (swapped) {
          this.loadedCount = loadedSoFar;
        } else if (loadedSoFar >= previousLoadedCount || after === null) {
          swapIn();
        } else {
          continue; // still catching up -- nothing new to show yet
        }
        this.emit();
      }
      stmt.free();

      if (persist && myGeneration === this.queryGeneration) {
        const server = await serverStateAtStart;
        // Nothing to stamp it with means nothing could ever validate it --
        // ensureLoaded() would discard it unread on the next load, so don't
        // spend the export/write at all.
        if (server) {
          writeCacheMeta(newDb, this.view, server, this.loadedCount);
          await saveToOpfs(this.view.opfsFilename, newDb.export());
        }
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

  /** Live-sync reaction for a view with a fixed `baseFilter` (see
   * useLiveSync.ts): a full requery rather than applyLiveChange()'s
   * incremental patch, since a thin notification can't tell whether the
   * changed row still matches `baseFilter` (same reasoning as the ordinary
   * whereExpr!==null guard, just permanent instead of only while the user
   * has typed a filter). Debounced (short, fixed delay) so a burst of
   * notifications for the same underlying table within one poll tick --
   * several Media rows changing together -- collapses into a single
   * requery instead of one per row.
   *
   * Suppresses runQuery()'s usual selection clear and reconciles it against
   * the freshly reloaded cache instead (same "handle survives, index gets
   * re-derived" treatment applyLiveChange() gives a selected row) -- a
   * baseFilter view is exactly the case where an unrelated live change is
   * expected to arrive *while* a row is open (Messages: someone else
   * adding a note shouldn't silently close the one you're reading). */
  requeryDebounced(): void {
    if (this.requeryTimer) return; // already scheduled
    this.requeryTimer = setTimeout(() => {
      this.requeryTimer = null;
      this.suppressSelectionClear = true;
      this.runQuery(this.whereExpr, false, { preserveDisplayUntilCaughtUp: true })
        .then(() => this.reconcileSelection())
        .catch((err) => {
          console.error(`[${this.view.label}] live-sync requery failed`, err);
        })
        .finally(() => {
          this.suppressSelectionClear = false;
          this.emit();
        });
    }, 300);
  }

  private insertPage(db: Database, stmt: ReturnType<Database["prepare"]>, items: Parameters<typeof toRowValues>[1][]) {
    db.run("BEGIN TRANSACTION;");
    for (const item of items) {
      stmt.run(toRowValues(this.view, item));
    }
    db.run("COMMIT;");
  }

  /** Patches this view's already-loaded, unfiltered cache in place for one
   * live-sync notification. Call only after useLiveSync.ts's own
   * table/whereExpr guard has passed -- this method only guards on cache
   * readiness. A DELETE removes the row locally; INSERT/UPDATE both refetch
   * the row fresh from the server (the notification itself carries no
   * data), place it (INSERT a genuinely new row, or UPDATE an existing one
   * in place -- see updateSql()'s doc comment on why UPDATE, not upsert),
   * then reposition it to its authoritative server rank (globalRankOfItem()
   * / repositionRow()) so local sort order is correct immediately, not
   * just once the row happens to get reloaded.
   *
   * A rank that falls outside the currently-loaded prefix (only possible
   * while runQuery()'s background fill is still in flight -- it always
   * finishes loading every row shortly after the view opens) means this
   * row doesn't belong in the local cache at all right now: it's evicted
   * (existing row) or simply not inserted (new row) rather than rendered
   * at a wrong position, and background fill picks it up correctly, in
   * its right place, once it reaches that far. */
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
      const rank = await this.globalRankOfItem(item, token);

      if (existed) {
        if (rank < this.loadedCount) {
          const stmt = this.db.prepare(updateSql(this.view));
          stmt.run(toUpdateRowValues(this.view, item));
          stmt.free();
          this.repositionRow(notification.handle, rank);
        } else {
          // The edit moved this row's true rank past what's currently
          // loaded -- evict it. totalCount is unaffected (an edit, not
          // an add/remove).
          this.db.run(`DELETE FROM ${this.view.key} WHERE handle = ?;`, [notification.handle]);
          this.loadedCount -= 1;
        }
      } else if (rank <= this.loadedCount) {
        const stmt = this.db.prepare(insertSql(this.view));
        stmt.run(toRowValues(this.view, item));
        stmt.free();
        this.repositionRow(notification.handle, rank);
        this.loadedCount += 1;
        this.totalCount += 1;
      } else {
        // Belongs further down than what's loaded so far -- same
        // reasoning as the eviction branch above, minus the eviction (it
        // was never inserted locally to begin with). totalCount still
        // grows: the row is real, just not locally cached yet.
        this.totalCount += 1;
      }
    }

    if (notification.handle === this.selectedHandle) {
      this.selectedRevision += 1;
    }
    this.reconcileSelection();
    this.emit();
  }

  private persistLiveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Debounced OPFS write-back after applyLiveChange() has patched this
   * view's cache -- without this, a tab that's been open and perfectly
   * live-synced all session still has its OPFS file stamped with whatever
   * cursor its last cold load captured, so isCacheStale() sees the tree
   * cursor has moved on every later reload and pays a refetch regardless of
   * how current the cache actually is (see cacheMeta.ts's tableTouchedSince
   * doc comment). `cursor` is the live-sync poll's own position
   * (historyPoll.ts's afterId) -- not fetchServerState()'s, which is
   * memoized once per page load and would go stale the moment any real time
   * passes in a long-running tab. Skipped for a filtered view: same "only
   * the unfiltered dataset persists" rule runQuery()'s persist branch
   * follows, since a filtered result isn't "the cache". Debounced (short,
   * fixed delay) so a burst of same-tick patches writes OPFS once, not once
   * per row. */
  persistLiveState(cursor: number): void {
    if (!this.db || this.whereExpr !== null) return;
    if (this.persistLiveTimer) clearTimeout(this.persistLiveTimer);
    this.persistLiveTimer = setTimeout(() => {
      this.persistLiveTimer = null;
      if (!this.db || this.whereExpr !== null) return;
      updateCachedCursor(this.db, cursor);
      saveToOpfs(this.view.opfsFilename, this.db.export()).catch((err) => {
        console.error(`[${this.view.label}] live-sync persist failed`, err);
      });
    }, 1000);
  }

  /** Moves `handle`'s row to local index `targetIndex`, preserving every
   * other row's relative order -- the only way to place a row correctly
   * without re-sorting locally by column value (see getRows()'s doc
   * comment on why that's unsafe: SQLite's collation can disagree with
   * the server's). Renumbers rowids via a disjoint negative staging range
   * first, rather than assigning straight to final values one row at a
   * time: rowid acts as a de-facto unique key here, so writing a row's
   * final value while another row still holds it would collide mid-loop. */
  private repositionRow(handle: string, targetIndex: number): void {
    if (!this.db) return;
    const res = this.db.exec(`SELECT handle FROM ${this.view.key} ORDER BY rowid;`);
    const handles = (res[0]?.values ?? []).map((row) => row[0] as string);
    const rest = handles.filter((h) => h !== handle);
    const index = Math.max(0, Math.min(targetIndex, rest.length));
    rest.splice(index, 0, handle);

    this.db.run("BEGIN TRANSACTION;");
    const toStaging = this.db.prepare(`UPDATE ${this.view.key} SET rowid = ? WHERE handle = ?;`);
    rest.forEach((h, i) => toStaging.run([-(i + 1), h]));
    toStaging.free();
    const toFinal = this.db.prepare(`UPDATE ${this.view.key} SET rowid = ? WHERE rowid = ?;`);
    rest.forEach((_, i) => toFinal.run([i, -(i + 1)]));
    toFinal.free();
    this.db.run("COMMIT;");
  }

  /** The local 0-based index `handle` currently occupies, or null if it's
   * not in the cache at all -- the reverse of getHandleAt(), ranked the
   * same way ("how many rows sort before this one" by rowid), so it stays
   * correct not just when `handle`'s own rowid has moved but also when an
   * unrelated row's INSERT/DELETE/reposition has shifted everything after
   * it by one. */
  private getIndexForHandle(handle: string): number | null {
    if (!this.db) return null;
    const rowidRes = this.db.exec(`SELECT rowid FROM ${this.view.key} WHERE handle = ?;`, [handle]);
    const rowid = rowidRes[0]?.values[0]?.[0];
    if (rowid === undefined) return null;
    const countRes = this.db.exec(`SELECT COUNT(*) FROM ${this.view.key} WHERE rowid < ?;`, [rowid]);
    return Number(countRes[0]?.values[0]?.[0] ?? 0);
  }

  /** Re-derives selectedIndex from selectedHandle against the current
   * cache -- call after every local mutation that could have moved rows
   * around (an edit repositioning itself via repositionRow(), an
   * unrelated row's INSERT/DELETE/reposition shifting everyone after it,
   * ...). DataTable.tsx highlights/scrolls/arrow-navigates by
   * selectedIndex alone, so a stale one left over from before a live-sync
   * patch can silently point at a different row than the one actually
   * selected. Drops the selection to "none" if the handle no longer
   * exists in the cache at all -- e.g. the selected row itself was just
   * live-deleted, or its own edit moved it beyond what's currently loaded
   * (applyLiveChange()'s eviction branch). */
  private reconcileSelection(): void {
    if (this.selectedHandle !== null) {
      const index = this.getIndexForHandle(this.selectedHandle);
      if (index === null) {
        this.selectedIndex = null;
        this.selectedHandle = null;
        this.selectionIsDefault = false;
      } else {
        this.selectedIndex = index;
      }
    }
    // Losing the selected row to a live delete/eviction leaves the detail
    // panes with nothing to show -- fall back to the view's default rather
    // than blanking them (see applyDefaultSelection).
    this.applyDefaultSelection();
  }
}
