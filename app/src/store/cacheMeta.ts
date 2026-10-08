// Staleness detection for the per-view OPFS caches (see opfs.ts).
//
// ViewStore.ensureLoaded() used to trust an on-disk cache unconditionally
// once it opened cleanly, so anything that changed the server's data
// without going through this tab's live-sync path left a cache that looked
// fine and served rows that no longer existed. In development that's the
// normal case, not an edge case: pointing VITE_API_BASE at a different
// backend, restarting the backend on a different fixture database,
// importing a .gramps file from the CLI, or editing a view's columns in
// views.ts all leave every cache silently wrong.
//
// So each cached database carries a small `_cache_meta` table describing
// what it was built from, and ensureLoaded() compares that against the
// server's current state before trusting it. A mismatch just deletes the
// file and refetches -- the cache is derived data, never the only copy of
// anything, so throwing it away is always safe and the only cost of a
// false positive is one refetch.
import type { Database } from "sql.js";
import { API_BASE } from "../config";
import { getToken, getTreeId, getCurrentUsername } from "../auth/auth";
import { fetchMetadata } from "./metadataApi";
import type { ViewConfig } from "./views";

const META_TABLE = "_cache_meta";

/** Bump to invalidate every existing cache when the meta format itself
 * changes (a cache written by an older format can't be meaningfully
 * compared against a newer one). */
const META_VERSION = "1";

/** What the server looked like when a cache was written, or looks like
 * now -- the two sides ensureLoaded() compares. */
interface ServerState {
  /** Identity of the database being served. `database.name`/`database.id`
   * from /api/metadata/ -- the check that catches a dev backend restarted
   * on a different fixture, which the JWT's `tree` claim can't: in
   * single-tree mode (the usual dev setup) there is no `tree` claim at
   * all. */
  dbName: string;
  dbId: string;
  /** The server's Gramps version (/api/metadata/'s gramps.version), "" if
   * not reported. */
  grampsVersion: string;
  /** Per-object-type row counts (/api/metadata/'s object_counts), keyed by
   * this app's own view/table keys rather than the API's plural names. */
  counts: Record<string, number>;
  /** Newest transaction id in the tree's undo log, or null if the history
   * endpoint isn't available to this user (it requires PERM_VIEW_PRIVATE,
   * see gramps-web-api's history.py). Every real mutation appends to that
   * log, so an unchanged id means the data is byte-for-byte unchanged --
   * strictly stronger than the row counts, which agree whenever a change
   * happened to leave the count alone (any edit, or a swapped fixture that
   * happens to be the same size). Both are checked: the counts are the
   * fallback when this is null, and the cursor catches what counts miss. */
  cursor: number | null;
}

/** /api/metadata/'s object_counts keys -> this app's view/table keys. */
const COUNT_KEY_BY_TABLE: Record<string, string> = {
  person: "people",
  family: "families",
  event: "events",
  place: "places",
  repository: "repositories",
  source: "sources",
  citation: "citations",
  media: "media",
  note: "notes",
  tag: "tags",
};

function hash(text: string): string {
  // FNV-1a, 32-bit -- this only needs to change when its input changes,
  // not to resist collisions from an adversary, so there's no reason to
  // pull in a real digest (or to go async for crypto.subtle).
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Fingerprint of everything in a ViewConfig that determines what ends up
 * *stored* in its cached table -- so editing views.ts invalidates the
 * caches that edit affects, which is the other half of dev staleness (the
 * data is fine, the code that shaped it changed).
 *
 * Includes each column's `toSql` source text, since that function decides
 * the stored value (JSON.stringify would silently drop it -- functions
 * aren't JSON). Deliberately excludes `toDisplay` and `label`: those are
 * applied at render time to already-cached values, so changing one shows
 * up on the next paint without a refetch. A production rebuild that
 * reminifies `toSql` differently reads as a change here too, costing one
 * refetch per deploy -- the safe direction, and the alternative (ignoring
 * the mapping entirely) is the bug this exists to catch. */
export function schemaSignature(view: ViewConfig): string {
  return hash(
    JSON.stringify({
      endpoint: view.endpoint,
      baseFilter: view.baseFilter ?? null,
      orderBy: view.orderBy,
      columns: view.columns.map((c) => [c.key, c.select, c.sqlType, String(c.toSql ?? "")]),
    })
  );
}

/** Who the memoized state below was fetched as -- a login as a different
 * user (or, once tree switching exists, a different tree) without a page
 * reload has to refetch it rather than keep describing the previous
 * session's server. Without this, caches rebuilt after such a switch would
 * be stamped with the *old* tree's identity and cursor, and so read as
 * stale on every later load: a refetch per reload, forever. */
let memoIdentity: string | null = null;
let serverStatePromise: Promise<ServerState> | null = null;

function currentIdentity(): string {
  return `${getTreeId() ?? ""} ${getCurrentUsername() ?? ""}`;
}

/** The server's current state, fetched once per page load and shared by
 * every view (all ~12 of them validate against the same two responses, not
 * two responses each). Callers treat a failure as "can't tell" rather than
 * "stale" -- see isCacheStale(). */
export function fetchServerState(): Promise<ServerState> {
  if (!serverStatePromise || memoIdentity !== currentIdentity()) {
    memoIdentity = currentIdentity();
    serverStatePromise = loadServerState().catch((err) => {
      // Don't let one failed attempt poison every later caller this
      // session (a backend that wasn't up yet when the first view loaded).
      serverStatePromise = null;
      throw err;
    });
  }
  return serverStatePromise;
}

/** Drops the memoized server state so the next read refetches it. Called
 * by clearAllOpfs() (opfs.ts), i.e. after this tab itself has just made a
 * bulk server-side change (import, delete-all): the state captured before
 * that change must not be what a rebuilt cache then records itself as
 * being current with, or every subsequent load would see a cursor from
 * before the import, refetch, and write that same pre-import cursor back
 * -- stale forever, one refetch per reload. */
export function resetServerState(): void {
  serverStatePromise = null;
  latestIdPromise = null;
}

async function loadServerState(): Promise<ServerState> {
  const token = await getToken();
  const [metadata, cursor] = await Promise.all([fetchMetadata(token), fetchCursor(token)]);
  const rawCounts: Record<string, number> = metadata?.object_counts ?? {};
  const counts: Record<string, number> = {};
  for (const [table, countKey] of Object.entries(COUNT_KEY_BY_TABLE)) {
    if (typeof rawCounts[countKey] === "number") counts[table] = rawCounts[countKey];
  }
  return {
    dbName: String(metadata?.database?.name ?? ""),
    dbId: String(metadata?.database?.id ?? ""),
    grampsVersion: String(metadata?.gramps?.version ?? ""),
    counts,
    cursor,
  };
}

interface LatestTransactionIdResult {
  ok: boolean;
  status: number;
  id: number;
}

// Shared with historyPoll.ts's poll bootstrap (see fetchLatestTransactionId
// below): both independently ask "what's the newest transaction id" at
// startup -- this one to seed a cache-staleness check, that one to seed
// live-sync's own cursor -- so without sharing the in-flight request they'd
// fire two near-simultaneous requests for the same one row on every page
// load. Keyed by token rather than tree/user identity since a token change
// already implies an identity change in this app (multi-tree mode issues a
// fresh token per tree switch).
let latestIdPromise: Promise<LatestTransactionIdResult> | null = null;
let latestIdPromiseToken: string | null = null;

function fetchLatestTransactionIdOnce(token: string): Promise<LatestTransactionIdResult> {
  if (!latestIdPromise || latestIdPromiseToken !== token) {
    latestIdPromiseToken = token;
    latestIdPromise = (async () => {
      const res = await fetch(`${API_BASE}/api/transactions/history/?page=1&pagesize=1&sort=-id`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { ok: false, status: res.status, id: 0 };
      const transactions: { id?: number }[] = await res.json();
      // An empty log is a real, comparable state (a tree nothing has been
      // committed to yet), not an unknown one -- 0 sorts before any real id.
      return { ok: true, status: res.status, id: transactions.length > 0 ? Number(transactions[0].id ?? 0) : 0 };
    })().catch((err) => {
      latestIdPromise = null;
      throw err;
    });
  }
  return latestIdPromise;
}

/** Exported for historyPoll.ts's poll bootstrap -- see
 * fetchLatestTransactionIdOnce's doc comment for why this is shared rather
 * than each side asking separately. Callers each apply their own meaning to
 * a failed request instead of that meaning being decided here. */
export function fetchLatestTransactionId(token: string): Promise<LatestTransactionIdResult> {
  return fetchLatestTransactionIdOnce(token);
}

/** Newest transaction id, via a one-row descending page of the same
 * history endpoint live sync already polls (see historyPoll.ts). Returns
 * null rather than throwing when the endpoint is unavailable -- it needs
 * PERM_VIEW_PRIVATE, so an ordinary member gets a 403 here and simply
 * falls back to the row-count comparison. */
async function fetchCursor(token: string): Promise<number | null> {
  try {
    const result = await fetchLatestTransactionIdOnce(token);
    return result.ok ? result.id : null;
  } catch {
    return null;
  }
}

// Bounds tableTouchedSince()'s own walk. One page, not the paged fetch
// historyPoll.ts does tick by tick -- this only needs a yes/no answer, not
// every change, so there's no reason to drain a large backlog page by page
// here too.
export const STALE_CHECK_PAGESIZE = 1000;

interface HistoryChangeForWalk {
  obj_class: string;
}
interface HistoryTransactionForWalk {
  changes: HistoryChangeForWalk[];
}

/** Whether any change to `table` landed in the undo log after `afterId` --
 * lets isCacheStale() tell "something unrelated changed elsewhere in the
 * tree" (cache still good) apart from "this view's own table changed"
 * (cache stale), instead of the tree-wide cursor invalidating every view on
 * any change anywhere. Returns null ("can't tell") rather than false when
 * the walk can't rule it out: on a fetch failure, or when the page comes
 * back full (STALE_CHECK_PAGESIZE items -- there may be more beyond it this
 * single page can't see). A cache that far behind is due a refetch anyway
 * (see F1 -- it's a cheap one), so the safe default there is "stale". */
async function tableTouchedSince(afterId: number, table: string): Promise<boolean | null> {
  try {
    const token = await getToken();
    const res = await fetch(
      `${API_BASE}/api/transactions/history/?after_id=${afterId}&sort=id&page=1&pagesize=${STALE_CHECK_PAGESIZE}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const transactions: HistoryTransactionForWalk[] = await res.json();
    if (transactions.length >= STALE_CHECK_PAGESIZE) return null;
    return transactions.some((tx) => tx.changes.some((change) => change.obj_class.toLowerCase() === table));
  } catch {
    return null;
  }
}

/** Rewrites just `_cache_meta`'s cursor row in place, for a cache whose rows
 * are still current but whose stamped cursor has fallen behind -- either
 * isCacheStale() walked the log and found nothing touching this view's
 * table (see tableTouchedSince()), or a live-sync patch
 * (ViewStore.applyLiveChange) just brought the cached rows themselves up to
 * date. Silently a no-op if `_cache_meta` isn't there yet (a cache still
 * mid-write from its very first fetch this session) -- exactly as safe as
 * any other cache miss here: the next reload just pays one refetch instead
 * of trusting a cursor that was never written. */
export function updateCachedCursor(db: Database, cursor: number): void {
  try {
    db.run(`UPDATE ${META_TABLE} SET value = ? WHERE key = 'cursor';`, [String(cursor)]);
  } catch {
    // no _cache_meta table yet -- nothing to advance
  }
}

/** Writes the `_cache_meta` table into a database about to be exported to
 * OPFS. Call with the ServerState captured *before* the fetch that built
 * this database started: a change landing mid-fill then reads as stale on
 * the next load (one wasted refetch) instead of as current (a cache
 * missing that change, indefinitely). */
export function writeCacheMeta(db: Database, view: ViewConfig, server: ServerState, rowCount: number): void {
  const entries: Record<string, string> = {
    version: META_VERSION,
    apiBase: API_BASE,
    // Which tree, and whose view of it: permissions decide whether private
    // records are in the result at all, so one user's cache is not
    // interchangeable with another's even on the same tree.
    tree: getTreeId() ?? "",
    username: getCurrentUsername() ?? "",
    dbName: server.dbName,
    dbId: server.dbId,
    schema: schemaSignature(view),
    cursor: server.cursor === null ? "" : String(server.cursor),
    rowCount: String(rowCount),
  };
  db.run(`CREATE TABLE IF NOT EXISTS ${META_TABLE} (key TEXT PRIMARY KEY, value TEXT);`);
  db.run(`DELETE FROM ${META_TABLE};`);
  const stmt = db.prepare(`INSERT INTO ${META_TABLE} (key, value) VALUES (?, ?);`);
  for (const [key, value] of Object.entries(entries)) stmt.run([key, value]);
  stmt.free();
}

function readCacheMeta(db: Database): Record<string, string> | null {
  try {
    const res = db.exec(`SELECT key, value FROM ${META_TABLE};`);
    const rows = res[0]?.values ?? [];
    if (rows.length === 0) return null;
    return Object.fromEntries(rows.map((row) => [String(row[0]), String(row[1])]));
  } catch {
    return null; // written before this table existed -- can't be validated
  }
}

export interface CacheStaleResult {
  stale: boolean;
  /** Set only when `stale` is false but the tree-wide cursor has moved past
   * what this cache is stamped with -- nothing relevant to `view.table`
   * changed in the walked range, but the caller should still rewrite
   * `_cache_meta`'s cursor to this value (updateCachedCursor()) so a later
   * reload doesn't re-walk the same already-cleared range forever. */
  advanceCursorTo?: number;
}

/** Whether `db`'s cached rows can still be trusted for `view`.
 *
 * Structured as tiers, cheapest first. The identity/schema tier is local
 * (no request) and decides on its own; the server tiers only run if that
 * passes. A server that can't be reached at all is treated as "can't tell,
 * keep the cache" -- an offline reload should still show the last known
 * rows rather than wiping them and failing to refetch. */
export async function isCacheStale(db: Database, view: ViewConfig): Promise<CacheStaleResult> {
  const meta = readCacheMeta(db);
  if (meta === null) return { stale: true };

  if (
    meta.version !== META_VERSION ||
    meta.apiBase !== API_BASE ||
    meta.tree !== (getTreeId() ?? "") ||
    meta.username !== (getCurrentUsername() ?? "") ||
    meta.schema !== schemaSignature(view)
  ) {
    return { stale: true };
  }

  let server: ServerState;
  try {
    server = await fetchServerState();
  } catch {
    return { stale: false };
  }

  if (meta.dbName !== server.dbName || meta.dbId !== server.dbId) return { stale: true };

  // Both cursors known: an unchanged newest transaction id means nothing
  // has been committed to this *tree* since the cache was written -- the
  // cheap fast path, settled without a request beyond fetchServerState()
  // (which every view sharing this page load already paid for once). A
  // change elsewhere in the tree doesn't necessarily mean *this* table
  // changed, though, so a mismatch here isn't answered directly -- it's
  // handed to tableTouchedSince() to tell apart "someone edited a Note"
  // (this cache is still fine) from "someone edited a Person" (it isn't),
  // instead of invalidating every view on any change anywhere.
  if (meta.cursor !== "" && server.cursor !== null) {
    const cachedCursor = Number(meta.cursor);
    if (cachedCursor === server.cursor) return { stale: false };
    const touched = await tableTouchedSince(cachedCursor, view.table ?? view.key);
    if (touched === null) return { stale: true };
    return touched ? { stale: true } : { stale: false, advanceCursorTo: server.cursor };
  }

  // No cursor to compare (history endpoint not permitted) -- fall back to
  // the row count. Skipped for a baseFilter view, whose cached rows are a
  // subset of its table and so never match the table-wide count.
  const expected = view.baseFilter ? undefined : server.counts[view.table ?? view.key];
  if (expected === undefined) return { stale: false };
  return { stale: meta.rowCount !== String(expected) };
}
