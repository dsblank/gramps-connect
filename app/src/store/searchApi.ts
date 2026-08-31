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
  score: number;
}

/** `semantic` is deliberately not a parameter here -- View > Search all
 * always searches the plain full-text index, never the vector one (see
 * SearchView.tsx). `sort` is deliberately omitted from the request rather
 * than exposed as a parameter: leaving it out is what gives relevance
 * order (SearchQueryArgs.sort's only alternatives are `change`/`type`, and
 * semantic search rejects `sort` entirely) -- confirmed against
 * gramps-web-api's resources/search.py and search/indexer.py. `objectType`
 * is optional and omitted by default -- SearchView's "All" tab -- rather
 * than always sent, unlike `profile=all` below: narrowing to one type is a
 * real, user-visible choice (the type tabs), not a fixed decision this
 * function makes on the caller's behalf the way "always relevance order"
 * and "always profile=all" are. `profile=all` *is* always sent,
 * unconditionally -- it costs nothing extra (computed server-side as part
 * of the same request, not a second round trip) and is what gives
 * SearchView's per-result detail line something real to show instead of
 * just a bare title. */
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
