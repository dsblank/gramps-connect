// What a Gramplet's get_selected()/get_filter() see -- shared by the View
// Gramplet panel (PyodidePocPanel.tsx, which always runs against its own
// list) and (window) Gramplets (GrampletWindow.tsx), which aren't tied to
// any list and instead read whichever object-type list is open in the main
// view at the moment Run is clicked.
import { parseHash } from "../hash";
import { getViewStore } from "../store/registry";
import { VIEWS } from "../store/views";
import { OBJECT_QUERY_ENDPOINTS } from "./objectEndpoints";

// The filter a Gramplet's get_filter() sees and Gramplet.listensToFilter
// watches for changes -- FilterBar's own typed search box (whereExpr) ANDed
// with the "Filters" picker's saved-filter/custom-rule contribution
// (pickerExpr), either/both/neither of which may be active. Deliberately
// excludes ViewStore's own combinedFilter()'s third ingredient, baseFilter
// (e.g. Notes/Topics/Stories) -- that's a structural property of the view
// itself, not something the user applied, so a listening Gramplet shouldn't
// treat being tabbed onto such a view as "the filter changed". Bug fixed
// 2026-09-15: applying/clearing a saved filter or Custom Rule through the
// Filters picker used to change only pickerExpr, which get_filter()/
// listensToFilter never looked at -- a Gramplet re-ran on a FilterBar search
// but sat stale through a picker-applied filter.
export function grampletFilterExpr(snapshot: { whereExpr: string | null; pickerExpr: string | null }): string | null {
  const parts = [snapshot.pickerExpr, snapshot.whereExpr].filter((part): part is string => !!part);
  return parts.length === 0 ? null : parts.map((part) => `(${part})`).join(" and ");
}

/** The main view's context, as a (window) Gramplet would see it if run
 * right now. All null when the main view isn't an object-type list (Home,
 * a chart, the Output view, ...): there's nothing selected or filtered
 * that a Gramplet's get_selected()/get_filter() could meaningfully use. */
export interface MainViewContext {
  /** The list's key ("person", ...), which is also get_selected()'s type. */
  viewKey: string | null;
  /** The list's own display label ("People"), for "Current filter on
   * People". */
  viewLabel: string | null;
  selectedHandle: string | null;
  whereExpr: string | null;
  /** How many rows the list shows under that filter, if known yet. */
  filteredCount: number | null;
}

const NO_CONTEXT: MainViewContext = {
  viewKey: null, viewLabel: null, selectedHandle: null, whereExpr: null, filteredCount: null,
};

let lastContext: MainViewContext = NO_CONTEXT;

/** The same object back while nothing in it changed -- it's read through
 * useSyncExternalStore, which re-renders (forever, if every call returns
 * a fresh object) whenever the snapshot isn't `===` the previous one. */
export function readMainViewContext(): MainViewContext {
  const { viewKey } = parseHash();
  let next = NO_CONTEXT;
  if (viewKey in OBJECT_QUERY_ENDPOINTS) {
    const snapshot = getViewStore(viewKey).getSnapshot();
    const whereExpr = grampletFilterExpr(snapshot);
    next = {
      viewKey,
      viewLabel: VIEWS.find((view) => view.key === viewKey)?.label ?? viewKey,
      selectedHandle: snapshot.selectedHandle,
      whereExpr,
      filteredCount: whereExpr && snapshot.status === "ready" ? snapshot.totalCount : null,
    };
  }
  const changed = (Object.keys(next) as (keyof MainViewContext)[]).some((key) => next[key] !== lastContext[key]);
  if (changed) lastContext = next;
  return lastContext;
}

/** Calls `listener` whenever readMainViewContext() may have changed: the
 * route (a different list, or a different selection arriving via a link)
 * or any list's own state (selection, filter, count). Subscribes to every
 * object-type list rather than re-subscribing on each route change -- they
 * all exist for the life of the page anyway (store/registry.ts). */
export function subscribeMainViewContext(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  const unsubscribes = Object.keys(OBJECT_QUERY_ENDPOINTS).map((key) => getViewStore(key).subscribe(listener));
  return () => {
    window.removeEventListener("hashchange", listener);
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
