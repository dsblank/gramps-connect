// Layer 2 spike, browser entry point: fetch from a real gramps-web-api
// POST /api/<type>/query/ instance (Layer 4's fast, SQL-pushed-down
// endpoint -- keyset-paginated, not the old full-table /api/<type>/ dump),
// cache into a WASM SQLite db (one table per object type -- see views.ts),
// persist each to OPFS so subsequent visits skip the network fetch
// entirely, and time filter/sort queries against the local cache.
//
// UI: a left sidebar (see views.ts's VIEWS) selects which object type is
// active; a virtualized, scrollable table shows it -- a spacer div sized
// to totalCount * ROW_HEIGHT gives the real browser scrollbar correct
// proportions for the whole (server-side) dataset, but only the rows in
// view are ever queried/rendered. Page one's `count: true` response sets
// that total immediately; every later page just fills the local cache in
// the background, in the same order the table displays -- so "has the row
// at scroll position N been loaded yet" is just "is N < loadedCount", no
// per-position fetch or jump-ahead needed. Each view keeps its own cache
// (db/loadedCount/totalCount/OPFS file), independent of the others --
// switching views doesn't lose what's already loaded.
import initSqlJs, { Database } from "sql.js";
import { VIEWS, type ViewConfig, type ColumnConfig } from "./views";

// ../api-fixture-example (port 5002) -- Gramps' own official example.gramps
// sample database, not ../api-fixture's gramps-bench-generated data (port
// 5001): the bench data is all plain, unmodified dates, so it never
// exercises gramps-date's modifier/quality/range/span handling at all. To
// switch back to the 100k-person bench dataset, swap these three
// constants for API_BASE="http://localhost:5001", USERNAME="testuser",
// PASSWORD="testpass" (see ../api-fixture/setup.sh). Served on a different
// origin than this static client either way, so CORS_ORIGINS must be set
// in the target's config.cfg for this to work.
const API_BASE = "http://localhost:5002";
const USERNAME = "exampleuser";
const PASSWORD = "examplepass";
// Server-side max (see QueryBodyArgs.limit's Range(min=1, max=1000) in
// gramps-web-api's object_query.py) -- fewer round trips for a fixed
// dataset size than the default limit=50.
const PAGE_SIZE = 1000;

type QueryItem = Record<string, unknown> & { handle: string };

interface QueryPage {
  items: QueryItem[];
  next_after: string | null;
}

function toSelectEntry(column: ColumnConfig): string | { json_path: (string | number)[]; as: string } {
  if (typeof column.select === "string") return column.select;
  return { ...column.select, as: column.key };
}

async function login(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`login failed: ${res.status} ${await res.text()}`);
  }
  const { access_token } = await res.json();
  return access_token;
}

async function fetchPage(
  view: ViewConfig,
  token: string,
  after: string | null,
  wantCount: boolean,
  whereExpr: string | null
): Promise<{ page: QueryPage; totalCount: number | null }> {
  const res = await fetch(`${API_BASE}${view.endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      select: ["handle", ...view.columns.map(toSelectEntry)],
      order_by: view.orderBy,
      limit: PAGE_SIZE,
      after: after ?? undefined,
      count: wantCount,
      where_expr: whereExpr || undefined,
    }),
  });
  if (!res.ok) {
    // QueryLangError etc. come back as {"error": {"code", "message"}} --
    // surface .message (e.g. "invalid syntax: ...") rather than the raw
    // envelope, falling back to the raw body if it's not that shape.
    const body = await res.text();
    let message = body;
    try {
      message = JSON.parse(body)?.error?.message ?? body;
    } catch {
      // not JSON, use the raw body as-is
    }
    throw new Error(message);
  }
  const totalCountHeader = res.headers.get("X-Total-Count");
  return {
    page: await res.json(),
    totalCount: totalCountHeader ? parseInt(totalCountHeader, 10) : null,
  };
}

function log(msg: string) {
  const el = document.getElementById("log")!;
  el.textContent += msg + "\n";
}

async function loadFromOpfs(filename: string): Promise<Uint8Array | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(filename);
    const file = await fileHandle.getFile();
    const buf = await file.arrayBuffer();
    return buf.byteLength > 0 ? new Uint8Array(buf) : null;
  } catch {
    return null;
  }
}

async function saveToOpfs(filename: string, data: Uint8Array) {
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data as BufferSource);
  await writable.close();
}

async function clearOpfs(filename: string) {
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(filename);
  } catch {
    // nothing to remove
  }
}

function timeQuery(db: Database, label: string, sql: string) {
  const t0 = performance.now();
  const res = db.exec(sql);
  const ms = performance.now() - t0;
  const rows = res[0]?.values.length ?? 0;
  log(`${label}: ${ms.toFixed(2)}ms, ${rows} rows`);
}

function createTableSql(view: ViewConfig): string {
  const cols = view.columns.map((c) => `  ${c.key} ${c.sqlType}`).join(",\n");
  const orderCol = view.orderBy[0]?.column;
  const index = orderCol ? `CREATE INDEX ${view.key}_${orderCol} ON ${view.key}(${orderCol});` : "";
  return `
    CREATE TABLE ${view.key} (
      handle TEXT PRIMARY KEY,
    ${cols}
    );
    ${index}
  `;
}

function insertSql(view: ViewConfig): string {
  const names = ["handle", ...view.columns.map((c) => c.key)];
  const placeholders = names.map(() => "?").join(", ");
  return `INSERT INTO ${view.key} (${names.join(", ")}) VALUES (${placeholders});`;
}

function insertPage(view: ViewConfig, db: Database, stmt: ReturnType<Database["prepare"]>, items: QueryItem[]) {
  db.run("BEGIN TRANSACTION;");
  for (const item of items) {
    const values = [
      item.handle,
      ...view.columns.map((c) => {
        const raw = item[c.key];
        return c.toSql ? c.toSql(raw) : (raw as string | number | null | undefined) ?? null;
      }),
    ];
    stmt.run(values);
  }
  db.run("COMMIT;");
}

interface ViewState {
  db: Database | null;
  loadedCount: number;
  totalCount: number;
  /** Bumped on every runQuery() call for this view; a stale in-flight
   * background fill checks this and bails out rather than clobbering a
   * newer query's state once the user has moved on to a different
   * where_expr (or away from this view entirely). */
  queryGeneration: number;
}

const viewStates = new Map<string, ViewState>(VIEWS.map((v) => [v.key, { db: null, loadedCount: 0, totalCount: 0, queryGeneration: 0 }]));

let currentView: ViewConfig = VIEWS[0];

function state(): ViewState {
  return viewStates.get(currentView.key)!;
}

function renderStatus() {
  const s = state();
  document.getElementById("load-status")!.textContent =
    s.totalCount > 0 ? `loaded ${s.loadedCount.toLocaleString()} / ${s.totalCount.toLocaleString()}` : "";
}

// Virtualized scroll: a spacer div sized to totalCount * ROW_HEIGHT gives
// the real browser scrollbar correct proportions/position for the full
// (server-side) dataset, but only the rows actually in view are ever
// queried from local SQLite or rendered as DOM nodes -- the analog, on the
// client, of what keyset pagination does server-side (never materialize
// what isn't being looked at).
const ROW_HEIGHT = 28;
const BUFFER_ROWS = 6;

function currentFirstVisible(): number {
  const scrollEl = document.getElementById("table-scroll")!;
  return Math.floor(scrollEl.scrollTop / ROW_HEIGHT);
}

function renderVisible(firstVisible: number) {
  const view = currentView;
  const s = state();
  const scrollEl = document.getElementById("table-scroll")!;
  const rowsEl = document.getElementById("visible-rows") as HTMLDivElement;
  const visibleCount = Math.ceil(scrollEl.clientHeight / ROW_HEIGHT) + BUFFER_ROWS;
  const first = Math.max(firstVisible, 0);

  rowsEl.style.transform = `translateY(${first * ROW_HEIGHT}px)`;
  rowsEl.replaceChildren();

  if (first >= s.loadedCount || !s.db) {
    const row = document.createElement("div");
    row.className = "row";
    row.textContent = "loading… (background fill hasn't reached this row yet)";
    rowsEl.appendChild(row);
    return;
  }

  const orderCol = view.orderBy[0]?.column ?? "handle";
  const t0 = performance.now();
  const res = s.db.exec(
    `SELECT ${view.columns.map((c) => c.key).join(", ")} FROM ${view.key} ` +
    `ORDER BY ${orderCol}, handle LIMIT ? OFFSET ?;`,
    [visibleCount, first]
  );
  const ms = performance.now() - t0;
  const rows = res[0]?.values ?? [];
  for (const row of rows) {
    const rowEl = document.createElement("div");
    rowEl.className = "row";
    row.forEach((cell, i) => {
      const column = view.columns[i];
      const text = column.toDisplay ? column.toDisplay(cell) : cell === null || cell === undefined ? "" : String(cell);
      const cellEl = document.createElement("div");
      cellEl.textContent = text;
      rowEl.appendChild(cellEl);
    });
    rowsEl.appendChild(rowEl);
  }
  log(`[${view.label}] scroll window @${first}: ${ms.toFixed(2)}ms, ${rows.length} rows`);
}

let scrollRenderScheduled = false;

// Attached once; a fresh runQuery() call (initial load, a view switch, or
// a where_expr filter) just changes what renderVisible() finds in
// state()/currentView, it doesn't need its own listener.
function attachScrollListener() {
  const scrollEl = document.getElementById("table-scroll")!;
  scrollEl.addEventListener("scroll", () => {
    if (scrollRenderScheduled) return;
    scrollRenderScheduled = true;
    requestAnimationFrame(() => {
      scrollRenderScheduled = false;
      renderVisible(currentFirstVisible());
    });
  });
}

function renderTableHeader() {
  const headerEl = document.getElementById("table-header")!;
  headerEl.replaceChildren();
  for (const column of currentView.columns) {
    const div = document.createElement("div");
    div.textContent = column.label;
    headerEl.appendChild(div);
  }
  const gridColumns = `repeat(${currentView.columns.length}, 1fr)`;
  headerEl.style.setProperty("--grid-columns", gridColumns);
  document.getElementById("visible-rows")!.style.setProperty("--grid-columns", gridColumns);
}

function resetScroll() {
  const scrollEl = document.getElementById("table-scroll")!;
  document.getElementById("scroll-spacer")!.style.height = `${state().totalCount * ROW_HEIGHT}px`;
  scrollEl.scrollTop = 0;
  renderStatus();
  renderVisible(0);
}

function runDiagnosticQueries() {
  const view = currentView;
  const db = state().db;
  if (!db) return;
  const orderCol = view.orderBy[0]?.column ?? "handle";
  log(`\n--- [${view.label}] queries against local cache ---`);
  timeQuery(db, `sort by ${orderCol}, page 1`, `SELECT handle FROM ${view.key} ORDER BY ${orderCol} LIMIT 50;`);
  timeQuery(db, "count all", `SELECT COUNT(*) FROM ${view.key};`);
}

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let cachedToken: string | null = null;

async function getToken(): Promise<string> {
  if (!cachedToken) {
    const t0 = performance.now();
    cachedToken = await login();
    log(`logged in to ${API_BASE} in ${(performance.now() - t0).toFixed(1)}ms`);
  }
  return cachedToken;
}

// Fetches a fresh (optionally where_expr-filtered) copy of the given
// view's object list from scratch: page one sets the scrollbar bounds and
// makes the table live -- runQuery() resolves right there, same as the
// original single-fetch flow, so callers (initial load, a view switch, or
// a filter Apply click) aren't blocked on the full dataset. Everything
// past page one fills in detached, in the background; a where_expr syntax
// error (a rejected page-one request) propagates to the caller normally,
// but a background-fill failure only gets logged, since by then the
// caller has already moved on. Only the unfiltered initial load persists
// to OPFS -- a filtered result isn't "the dataset", so it shouldn't
// overwrite that cache.
async function runQuery(view: ViewConfig, whereExpr: string | null, persist: boolean) {
  const s = viewStates.get(view.key)!;
  const myGeneration = ++s.queryGeneration;
  const token = await getToken();

  const newDb = new SQL.Database();
  newDb.run(createTableSql(view));
  const stmt = newDb.prepare(insertSql(view));

  let after: string | null = null;
  const first = await fetchPage(view, token, after, true, whereExpr);
  if (myGeneration !== s.queryGeneration) {
    stmt.free();
    return; // superseded by a newer query while this was in flight
  }

  s.db = newDb;
  s.totalCount = first.totalCount ?? 0;
  insertPage(view, s.db, stmt, first.page.items);
  s.loadedCount = first.page.items.length;
  after = first.page.next_after;
  log(`[${view.label}] page 1${whereExpr ? ` (where_expr: ${whereExpr})` : ""}: ${s.loadedCount}/${s.totalCount} -- scrollbar bounds set, table live`);
  if (currentView.key === view.key) resetScroll();

  (async () => {
    const fillStart = performance.now();
    let pageNum = 1;
    while (after !== null) {
      const { page } = await fetchPage(view, token, after, false, whereExpr);
      if (myGeneration !== s.queryGeneration) {
        stmt.free();
        return;
      }
      insertPage(view, s.db!, stmt, page.items);
      s.loadedCount += page.items.length;
      after = page.next_after;
      pageNum++;
      if (currentView.key === view.key) {
        renderStatus();
        const firstVisible = currentFirstVisible();
        if (firstVisible < s.loadedCount) renderVisible(firstVisible);
      }
    }
    stmt.free();
    const fillMs = performance.now() - fillStart;
    log(`[${view.label}] background fill done: ${s.loadedCount} in ${pageNum} page(s), ${fillMs.toFixed(1)}ms`);

    if (persist) {
      const exportStart = performance.now();
      await saveToOpfs(view.opfsFilename, s.db!.export());
      log(`[${view.label}] persisted to OPFS in ${(performance.now() - exportStart).toFixed(1)}ms`);
    }

    if (currentView.key === view.key) runDiagnosticQueries();
  })().catch((err) => log(`[${view.label}] background fill ERROR: ${err.stack ?? err}`));
}

/** Loads a view's cache if it hasn't been loaded yet this session (OPFS,
 * falling back to a fresh fetch); if it's already loaded, just re-renders
 * from what's already there. Called on startup (for the first view) and
 * whenever the sidebar switches views. */
async function ensureViewLoaded(view: ViewConfig) {
  const s = viewStates.get(view.key)!;
  if (s.db) {
    resetScroll();
    return;
  }

  const cached = await loadFromOpfs(view.opfsFilename);
  if (cached) {
    try {
      const t0 = performance.now();
      const db = new SQL.Database(cached);
      // A stale OPFS cache from before a schema change would otherwise
      // throw deep inside renderVisible(), uncaught, leaving the table
      // blank with no obvious cause -- treat any mismatch as "not cached"
      // and fall through to a fresh fetch.
      db.exec(`SELECT ${view.columns.map((c) => c.key).join(", ")} FROM ${view.key} LIMIT 1;`);
      log(`[${view.label}] loaded ${cached.byteLength.toLocaleString()} bytes from OPFS in ${(performance.now() - t0).toFixed(1)}ms (no network fetch)`);
      s.db = db;
      s.totalCount = s.loadedCount = Number(db.exec(`SELECT COUNT(*) FROM ${view.key};`)[0].values[0][0]);
      resetScroll();
      runDiagnosticQueries();
      return;
    } catch (err: any) {
      log(`[${view.label}] OPFS cache schema mismatch (${err.message ?? err}) -- discarding and re-fetching`);
      await clearOpfs(view.opfsFilename);
    }
  }
  await runQuery(view, null, true);
}

function setupFilterControls() {
  const input = document.getElementById("where-expr") as HTMLInputElement;
  const applyBtn = document.getElementById("apply-filter") as HTMLButtonElement;
  const clearBtn = document.getElementById("clear-filter") as HTMLButtonElement;
  const errorEl = document.getElementById("filter-error")!;

  async function apply(whereExpr: string | null) {
    errorEl.textContent = "";
    applyBtn.disabled = true;
    try {
      await runQuery(currentView, whereExpr, false);
    } catch (err: any) {
      errorEl.textContent = err.message ?? String(err);
      log(`[${currentView.label}] filter ERROR: ${err.stack ?? err}`);
    } finally {
      applyBtn.disabled = false;
    }
  }

  applyBtn.addEventListener("click", () => apply(input.value.trim() || null));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") apply(input.value.trim() || null);
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    apply(null);
  });

  // Quick-filter buttons compose into the same where_expr box rather than
  // bypassing it with a separate filter mechanism -- they just fill in
  // (and immediately apply) an example exists(...)/count(...) expression,
  // so the box stays the one thing that actually drives the query. Both
  // examples use the "events" relationship, which only Person has
  // registered among this package's views so far -- hidden for any other
  // view (see selectView()).
  document.getElementById("example-has-events")?.addEventListener("click", () => {
    input.value = "exists(events)";
    apply(input.value);
  });
  document.getElementById("example-many-events")?.addEventListener("click", () => {
    input.value = "count(events) > 2";
    apply(input.value);
  });
}

function setupSidebar() {
  const nav = document.getElementById("view-nav")!;
  for (const view of VIEWS) {
    const btn = document.createElement("button");
    btn.textContent = view.label;
    btn.dataset.viewKey = view.key;
    btn.addEventListener("click", () => selectView(view));
    nav.appendChild(btn);
  }
}

async function selectView(view: ViewConfig) {
  currentView = view;

  for (const btn of document.querySelectorAll<HTMLButtonElement>("#view-nav button")) {
    btn.classList.toggle("active", btn.dataset.viewKey === view.key);
  }

  const input = document.getElementById("where-expr") as HTMLInputElement;
  input.value = "";
  input.placeholder = view.wherePlaceholder;
  document.getElementById("filter-error")!.textContent = "";
  const showEventExamples = view.key === "person";
  document.getElementById("filter-examples")!.style.display = showEventExamples ? "" : "none";

  renderTableHeader();
  renderStatus();
  await ensureViewLoaded(view);

  document.getElementById("clear-opfs")!.onclick = async () => {
    await clearOpfs(view.opfsFilename);
    log(`[${view.label}] OPFS cache cleared — switch away and back to re-fetch from the network`);
  };
}

async function main() {
  log("main() started");
  SQL = await initSqlJs({ locateFile: (file) => `/${file}` });
  log("sql.js WASM initialized");

  attachScrollListener();
  setupFilterControls();
  setupSidebar();

  await selectView(VIEWS[0]);
}

main().catch((err) => log(`ERROR: ${err.stack ?? err}`));
