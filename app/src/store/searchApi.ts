// GET /api/search/ -- gramps-web-api's server-side full-text (or, with
// semantic=true, vector) index over every primary object type at once.
// Deliberately separate from api.ts's fetchPage/where_expr machinery: those
// query the local synced cache one object type at a time; this hits the
// server's own index across all ten types in one call, for View > Search
// all (SearchView.tsx) -- a real round trip, not something to run on every
// keystroke against a table's own local rows the way FilterBar's search
// boxes do.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";

/** One hit from the index. `object` carries the same raw, un-`extend`ed
 * fields summaryLine() (components/related/summary.ts) already knows how
 * to render for all ten `object_type` values, *plus* a `profile` field
 * (person/family/event/citation/place/media only -- repository/source/
 * note/tag get none, confirmed live against SearchResource's
 * get_object_from_handle switch in gramps-web-api's resources/search.py)
 * that searchSnippet.ts reads for the per-result detail line(s). Loosely
 * typed rather than given a real interface per type, same call summary.ts
 * already made for the same reason: ten different shapes, one function
 * that has to handle all of them. */
export interface SearchHit {
  handle: string;
  object_type: string;
  object: Record<string, unknown> & { profile?: Record<string, unknown> };
  /** The raw SQLite FTS5 bm25() value for this hit (gramps-web-api's
   * indexer.py: `score = hit.get("rank")`, the FTS5 `rank` hidden column,
   * a different thing from this same response's *own* `rank` field --
   * that one is just the hit's position in the page). Null only for a
   * wildcard/empty query (the `search.get()` branch in indexer.py, not
   * `search.query()`) -- SearchView never sends one, so in practice this
   * is always populated here. sortByRelevance() below is what actually
   * uses it. */
  score: number | null;
}

/** `semantic` is deliberately not a parameter here -- View > Search all
 * always searches the plain full-text index, never the vector one (see
 * SearchView.tsx). `sort` is deliberately omitted from the request: not
 * because leaving it out gives relevance order -- it doesn't, see
 * sortByRelevance()'s own doc comment below -- but because
 * SearchQueryArgs.sort only accepts `change`/`type`, neither of which is
 * relevance, and semantic search rejects `sort` outright. `objectType` is
 * optional and omitted by default -- SearchView's "All" tab -- rather than
 * always sent, unlike `profile=all` below: narrowing to one type is a
 * real, user-visible choice (the type tabs), not a fixed decision this
 * function makes on the caller's behalf the way "always profile=all" is.
 * `profile=all` *is* always sent, unconditionally -- it costs nothing
 * extra (computed server-side as part of the same request, not a second
 * round trip) and is what gives SearchView's per-result detail line
 * something real to show instead of just a bare title. */
export async function fetchSearch(
  token: string,
  query: string,
  page: number,
  pagesize: number,
  objectType?: string | null,
  signal?: AbortSignal
): Promise<{ hits: SearchHit[]; total: number }> {
  // Not `new URL(...)` -- API_BASE is "" in the common case (see config.ts),
  // which `new URL()` rejects as not absolute; every other fetch in this
  // codebase builds a plain relative string the same way.
  const params = new URLSearchParams({
    query,
    semantic: "false",
    profile: "all",
    page: String(page),
    pagesize: String(pagesize),
  });
  if (objectType) params.set("type", objectType);
  const res = await fetch(`${API_BASE}/api/search/?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }
  const totalCountHeader = res.headers.get("X-Total-Count");
  return {
    hits: (await res.json()) as SearchHit[],
    total: totalCountHeader ? parseInt(totalCountHeader, 10) : 0,
  };
}

/** gramps-web-api's /api/search/ does NOT actually return relevance order
 * when `sort` is omitted -- confirmed by reading `sifts` (the search
 * library behind it) directly: `SearchIndexerBase.search()`'s `order_by`
 * parameter (this module's `sort`, deliberately never sent -- see
 * fetchSearch's own doc comment) only ever adds a SQL `ORDER BY` when
 * given a real value; left out, `sifts/core.py`'s `query()` adds none at
 * all, so rows come back in whatever order SQLite's FTS5 `MATCH` happens
 * to enumerate them. Verified live: one query's raw hits arrived scored
 * -6.48, -6.91, -6.62, -6.76, ... -- nowhere close to sorted. And there's
 * no server-side fix available to ask for instead: SearchQueryArgs.sort
 * only accepts `change`/`type`, neither of which means relevance.
 *
 * So SearchView sorts the results itself, off each hit's own real bm25
 * `score` (already in the response, no extra request) -- correct to do
 * client-side specifically *because* SearchView only ever fetches one
 * page (RESULTS_LIMIT rows): sorting a single already-fetched page is
 * free, where a true multi-page relevance sort would need the server to
 * do it before slicing to a page at all.
 *
 * Ascending, not descending: SQLite's bm25() convention is that a *more
 * negative* score is a *better* match (https://sqlite.org/fts5.html#the_bm25_function).
 * A null score (see SearchHit.score) sorts last -- worse than any real
 * match, never better. */
export function sortByRelevance(hits: SearchHit[]): SearchHit[] {
  return [...hits].sort((a, b) => {
    if (a.score == null) return b.score == null ? 0 : 1;
    if (b.score == null) return -1;
    return a.score - b.score;
  });
}
