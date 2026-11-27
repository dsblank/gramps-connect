// A picker's search: the same plain-text search the record's own list uses
// (ViewConfig.simpleSearch.buildExpr, e.g. Media matches ID, description
// and path containing the text), in the list's default order, with matches
// that start with the text first. RecordPicker.tsx and the compact
// type-ahead pickers (useListSearch) share it, so finding a record works
// the same in every picker as in its list.
import { useEffect, useState } from "react";
import { getToken } from "../auth/auth";
import { fetchPage, type QueryItem } from "./api";
import { useNameGroupsVersion } from "./nameGroups";
import { prefixSearchExpr } from "./simpleSearch";
import type { ViewConfig } from "./views";

export interface ListSearchResult {
  items: QueryItem[];
  /** All matches, beyond `limit`; null when the server didn't say. */
  totalCount: number | null;
}

/** The list's own where_expr for `term` (the builders escape it), or null
 * for "everything". `buildExpr` overrides the list's default, e.g. a picker
 * that adds its own clauses. */
export function listSearchExpr(view: ViewConfig, term: string, buildExpr?: (term: string) => string | null): string | null {
  const clean = term.trim();
  const build = buildExpr ?? view.simpleSearch?.buildExpr;
  return build ? build(clean) : null;
}

/** Runs `whereExpr` against `view`. Matches that start with the term come
 * first, then the rest of the contains-matches -- otherwise a short exact
 * name ("USA") sorts behind `limit` alphabetically earlier places that
 * merely contain it ("Indiana, USA", ...) and can't be picked at all. Two
 * disjoint queries in parallel, so the total stays exact. */
export async function searchList(view: ViewConfig, whereExpr: string | null, limit: number): Promise<ListSearchResult> {
  const token = await getToken();
  // The view's default order -- for People, the tree's name format
  // (views.ts defaultOrderBy), not the static surname-first `orderBy`.
  const orderBy = view.defaultOrderBy?.() ?? view.orderBy;
  const prefixExpr = prefixSearchExpr(whereExpr);
  if (!prefixExpr) {
    const { page, totalCount } = await fetchPage(view, token, null, true, whereExpr, orderBy, limit);
    return { items: page.items, totalCount };
  }
  const [first, rest] = await Promise.all([
    fetchPage(view, token, null, true, prefixExpr, orderBy, limit),
    fetchPage(view, token, null, true, `(${whereExpr}) and not (${prefixExpr})`, orderBy, limit),
  ]);
  return {
    items: [...first.page.items, ...rest.page.items].slice(0, limit),
    totalCount: first.totalCount === null || rest.totalCount === null ? null : first.totalCount + rest.totalCount,
  };
}

/** Type-ahead form of searchList(): searches `view` for `query` after a
 * short pause in typing, only while `enabled` and once the list's search
 * accepts the text (most need two characters). */
export function useListSearch(view: ViewConfig, query: string, { enabled = true, limit = 10 }: { enabled?: boolean; limit?: number } = {}) {
  const [items, setItems] = useState<QueryItem[]>([]);
  const [loading, setLoading] = useState(false);
  // Person search folds in surname groups (nameGroups.ts), which can land
  // after the first search ran.
  const nameGroupsVersion = useNameGroupsVersion();
  useEffect(() => {
    const whereExpr = enabled ? listSearchExpr(view, query) : null;
    if (!whereExpr) {
      setItems([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      searchList(view, whereExpr, limit)
        .then((r) => !cancelled && setItems(r.items))
        .catch(() => {
          /* failed: keep the last results */
        })
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [view, query, enabled, limit, nameGroupsVersion]);
  return { items, loading };
}
