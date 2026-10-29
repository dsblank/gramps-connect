// GET /api/search/ -- gramps-web-api's server-side full-text index over
// every primary object type at once.
// Deliberately separate from api.ts's fetchPage/where_expr machinery: those
// query the local synced cache one object type at a time; this hits the
// server's own index across all ten types in one call, for View > Search
// all (SearchView.tsx) -- a real round trip, not something to run on every
// keystroke against a table's own local rows the way FilterBar's search
// boxes do.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import { apiFetch } from "./apiFetch";
import { getI18nSnapshot } from "../i18n/i18n";

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
  /** The hit's relevance score -- its scale (and which way is better)
   * depends on the server version and backend, see sortByRelevance(),
   * which is what actually uses it. Null only for a wildcard/empty query,
   * which SearchView never sends. */
  score: number | null;
}

/** `sort` is deliberately omitted from the request:
 * SearchQueryArgs.sort only accepts `change`/`type`, neither of which is
 * relevance, and leaving it out is what gets relevance order from a v3.25.0+
 * server (see sortByRelevance() below for older ones). `objectType` is
 * optional and omitted by default -- SearchView's "All" tab -- rather than
 * always sent, unlike `profile=all` below: narrowing to one type is a
 * real, user-visible choice (the type tabs), not a fixed decision this
 * function makes on the caller's behalf the way "always profile=all" is.
 * `profile=all` *is* always sent, unconditionally -- it costs nothing
 * extra (computed server-side as part of the same request, not a second
 * round trip) and is what gives SearchView's per-result detail line
 * something real to show instead of just a bare title. `locale` is the UI
 * language: it puts those profiles' dates and types in that language, and
 * from v3.25.0 (#1128) lets a standard type be found by its translated
 * name ("Taufe" finds baptisms). An unknown code falls back to the
 * server's default locale. */
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
    profile: "all",
    page: String(page),
    pagesize: String(pagesize),
  });
  // SearchQueryArgs.locale is at most 5 characters ("zh_CN") and a longer
  // one 422s the whole search -- every bootstrapped code fits, but a stored
  // language isn't guaranteed to be one of them.
  const { lang } = getI18nSnapshot();
  if (lang.length <= 5) params.set("locale", lang);
  if (objectType) params.set("type", objectType);
  // No nameFormatParam(): /api/search/'s query schema has no name_format and
  // gramps-web-api rejects unknown query args with a 422, so profiles'
  // name_display come in the server's own default name format.
  const res = await apiFetch(`${API_BASE}/api/search/?${params}`, {
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

/** Puts one page of hits in best-match-first order, for any server version.
 *
 * The score's scale depends on the server, and its sign tells which one:
 * - gramps-web-api v3.25.0+ (its own search index, #1089): -bm25() on
 *   SQLite or ts_rank() on PostgreSQL, >= 0, higher is better -- and
 *   already returned best first (`ORDER BY score DESC`).
 * - Older servers (the `sifts` library) on PostgreSQL: ts_rank(), >= 0,
 *   higher is better, but in no particular order.
 * - Older servers on SQLite: raw FTS5 bm25(), <= 0, *more negative* is
 *   better (https://sqlite.org/fts5.html#the_bm25_function), in whatever
 *   order FTS5's `MATCH` enumerated them -- no ORDER BY was ever added
 *   when `sort` was left out.
 *
 * So any positive score means sort descending (a no-op on v3.25.0+, whose
 * ties the stable sort keeps in server order), otherwise ascending.
 * Sorting client-side is only right because SearchView fetches a single
 * page (RESULTS_LIMIT rows). A null score sorts last -- worse than any real
 * match, never better. */
export function sortByRelevance(hits: SearchHit[]): SearchHit[] {
  const higherIsBetter = hits.some((hit) => hit.score != null && hit.score > 0);
  return [...hits].sort((a, b) => {
    if (a.score == null) return b.score == null ? 0 : 1;
    if (b.score == null) return -1;
    return higherIsBetter ? b.score - a.score : a.score - b.score;
  });
}
