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
import type { ViewConfig } from "./views";
import type { TreeChangeNotification } from "./liveSync";

export type RowState = "unloaded" | "loading" | "loaded";
export type ViewStatus = "idle" | "loading" | "ready" | "error";

export interface ViewSnapshot {
  loadedCount: number;
  totalCount: number;
  whereExpr: string | null;
  status: ViewStatus;
  error: string | null;
  /** Bumped on every emit(), including an in-place live-sync UPDATE that
   * leaves loadedCount/totalCount unchanged -- callers that cache windowed
   * row reads (see DataTable.tsx's useMemo) must key on this too, not just
   * loadedCount, or a same-count row patch silently never re-renders. */
  revision: number;
}

const EMPTY_SNAPSHOT: ViewSnapshot = {
  loadedCount: 0,
  totalCount: 0,
  whereExpr: null,
  status: "idle",
  error: null,
  revision: 0,
};

export class ViewStore {
  readonly view: ViewConfig;
  private getSql: () => Promise<SqlJsStatic>;
  private db: Database | null = null;
  private loadedCount = 0;
  private totalCount = 0;
  private whereExpr: string | null = null;
  private status: ViewStatus = "idle";
  private error: string | null = null;
  /** Bumped on every runQuery() call; a stale in-flight background fill
   * checks this and bails out rather than clobbering a newer query's state
   * once the caller has moved on to a different where_expr (or away from
   * this view entirely). */
  private queryGeneration = 0;
  private revision = 0;
  private listeners = new Set<() => void>();
  private snapshot: ViewSnapshot = EMPTY_SNAPSHOT;

  constructor(view: ViewConfig, getSql: () => Promise<SqlJsStatic>) {
    this.view = view;
    this.getSql = getSql;
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
      status: this.status,
      error: this.error,
      revision: this.revision,
    };
    for (const listener of this.listeners) listener();
  }

  getRowState(index: number): RowState {
    if (!this.db) return "unloaded";
    return index < this.loadedCount ? "loaded" : "loading";
  }

  /** Windowed read against the local cache, mirroring the original
   * renderVisible()'s single LIMIT/OFFSET query per scroll frame -- one
   * query for the whole visible range rather than one per row. Returns raw
   * column values in view.columns order; callers apply each column's
   * toDisplay themselves. */
  getRows(startIndex: number, count: number): unknown[][] {
    if (!this.db) return [];
    const orderCol = this.view.orderBy[0]?.column ?? "handle";
    const res = this.db.exec(
      `SELECT ${this.view.columns.map((c) => c.key).join(", ")} FROM ${this.view.key} ` +
      `ORDER BY ${orderCol}, handle LIMIT ? OFFSET ?;`,
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
        this.status = "ready";
        this.emit();
        return;
      } catch {
        await clearOpfs(this.view.opfsFilename);
      }
    }
    await this.runQuery(null, true);
  }

  /** Fetches a fresh (optionally where_expr-filtered) copy of this view's
   * object list from scratch. Page one sets the total count and makes the
   * cache queryable; everything past page one fills in detached, in the
   * background. Only an unfiltered result persists to OPFS -- a filtered
   * result isn't "the dataset", so it shouldn't overwrite that cache. */
  async runQuery(whereExpr: string | null, persist: boolean): Promise<void> {
    const myGeneration = ++this.queryGeneration;
    this.status = "loading";
    this.error = null;
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
      first = await fetchPage(this.view, token, after, true, whereExpr);
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
        const { page } = await fetchPage(this.view, token, after, false, whereExpr);
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
