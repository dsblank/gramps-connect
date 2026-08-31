// View > Search all's own state -- the submitted query text and the
// active type tab -- rides in the hash's own `?query` suffix
// (hash.ts's HashRoute.query, e.g. "#/search?q=smith&type=person"), not
// the browser's top-level `location.search`. SearchView.tsx writes it via
// `formatHash({ viewKey: "search", query: formatSearchUrlState(...) })`
// and a `history.replaceState`; this module only ever encodes/decodes the
// small `key=value&...` substring itself, so it stays pure and doesn't
// need to know how or where that substring ends up in the real URL.
const QUERY_PARAM = "q";
const TYPE_PARAM = "type";

export interface SearchUrlState {
  query: string;
  type: string | null;
}

/** Reads back whatever a previous submitted search (this page's own, or a
 * link someone else copied) left in the hash's `?query` suffix. `null`
 * (no suffix at all -- hash.ts's HashRoute.query, never yet searched) and
 * `""` (a suffix with neither param, shouldn't normally happen since
 * formatSearchUrlState below never produces one) both read the same way:
 * no search yet, matching SearchView's own idle state. */
export function parseSearchUrlState(query: string | null): SearchUrlState {
  const params = new URLSearchParams(query ?? "");
  return { query: params.get(QUERY_PARAM) ?? "", type: params.get(TYPE_PARAM) };
}

/** The inverse -- `null` (not `""`) when there's nothing worth putting in
 * the URL at all, so `formatHash({ ..., query: formatSearchUrlState(s) })`
 * naturally omits the `?` suffix entirely for an empty/cleared search
 * rather than writing a bare, pointless "#/search?". */
export function formatSearchUrlState(state: SearchUrlState): string | null {
  const params = new URLSearchParams();
  if (state.query) params.set(QUERY_PARAM, state.query);
  if (state.type) params.set(TYPE_PARAM, state.type);
  const qs = params.toString();
  return qs || null;
}
