/**
 * Built-in rules whose GOQL depends on the app's own state rather than on
 * values typed into the rule -- gramps-core's IsBookmarked (every type),
 * IsDefaultPerson (People) and MatchesFilter (every type). They're built
 * fresh from that state wherever the catalog is assembled
 * (FilterPickerDialog.tsx, ListHeader.tsx), the same way Custom Rules are
 * merged in, so a filter tree only ever stores their ids and picks up
 * the current bookmarks / home person / saved filter when it's applied.
 *
 * - "Bookmarked": `handle in [...]` over the tree's shared bookmarks for
 *   that type (bookmarks.ts).
 * - "Home person": this app's home person (homePersonPreference.ts) --
 *   per browser, unlike gramps-core's IsDefaultPerson, which uses the
 *   database's default person.
 * - "Matches saved filter": one rule per Saved Filter of the same type,
 *   whose expr is that filter's own tree compiled. A saved filter may use
 *   another one; one that ends up using itself is reported, not looped.
 *
 * A rule that can't be built right now (no home person, bookmarks not
 * loaded, a broken saved filter) carries `unavailableReason`, which
 * goqlFilterCombiner.ts's renderPreset() throws if it's ever compiled.
 */

import {
  GQL_FILTER_NAMESPACES, type GqlFilterNamespace, type GqlFilterPreset,
} from "../data/gqlFilterPresets";
import { combineFilterTree, type FilterTree, type FilterTreeNode } from "./goqlFilterTree";
import type { SavedFilter } from "./savedFilterMedia";
import { bookmarksLoaded, getBookmarks } from "./bookmarks";
import { getHomePersonHandle } from "./homePersonPreference";

export interface PresetContext {
  /** Bookmarked handles by namespace, or null if not loaded yet. */
  bookmarks: ((namespace: GqlFilterNamespace) => string[]) | null;
  homePersonHandle: string | null;
  savedFilters: readonly SavedFilter[];
}

export const SAVED_FILTER_PRESET_PREFIX = "saved-filter:";

/** Person's own built-in ids are bare ("bookmarked"); every other type's
 * are prefixed ("family-bookmarked"), same as gqlFilterPresets.ts. */
export function bookmarkedPresetId(namespace: GqlFilterNamespace): string {
  return namespace === "Person" ? "bookmarked" : `${namespace.toLowerCase()}-bookmarked`;
}

export const HOME_PERSON_PRESET_ID = "home-person";

/** `handle in [...]`, or a condition nothing matches for an empty list
 * (GOQL rejects `in []`). Handles are server-generated alphanumerics, but
 * quotes are stripped anyway since this is spliced into GOQL text. */
export function handleListExpr(handles: readonly string[]): string {
  const safe = handles.map((h) => h.replace(/['\\]/g, "")).filter((h) => h !== "");
  if (safe.length === 0) return "handle == ''";
  if (safe.length === 1) return `handle == '${safe[0]}'`;
  return `handle in [${safe.map((h) => `'${h}'`).join(", ")}]`;
}

function bookmarkedPreset(namespace: GqlFilterNamespace, context: PresetContext): GqlFilterPreset {
  const preset: GqlFilterPreset = {
    id: bookmarkedPresetId(namespace), label: "Bookmarked", category: "Properties", namespace,
    // gramps-core has IsBookmarked only for People and Families.
    sourceRule: namespace === "Person" || namespace === "Family" ? "IsBookmarked" : "",
    expr: "handle == ''", supported: true,
  };
  if (!context.bookmarks) return { ...preset, unavailableReason: "the bookmarks haven't loaded yet" };
  return { ...preset, expr: handleListExpr(context.bookmarks(namespace)) };
}

function homePersonPreset(context: PresetContext): GqlFilterPreset {
  const preset: GqlFilterPreset = {
    id: HOME_PERSON_PRESET_ID, label: "Home person", category: "Properties", namespace: "Person",
    sourceRule: "IsDefaultPerson", expr: "handle == ''", supported: true,
    notes: "This app's home person (set on the Home page), not the database's default person that the desktop rule uses.",
  };
  if (!context.homePersonHandle) return { ...preset, unavailableReason: "no home person is set" };
  return { ...preset, expr: handleListExpr([context.homePersonHandle]) };
}

function savedFilterIdsIn(node: FilterTreeNode, out: Set<string>): Set<string> {
  if (node.kind === "rule") {
    if (node.presetId.startsWith(SAVED_FILTER_PRESET_PREFIX)) out.add(node.presetId.slice(SAVED_FILTER_PRESET_PREFIX.length));
  } else if (node.kind === "rule-group") {
    for (const child of node.children) savedFilterIdsIn(child, out);
  }
  return out;
}

/** The app-state rules for every namespace, given the rest of the catalog
 * (built-ins plus Custom Rules) that saved filters may use. */
export function contextPresets(basePresets: readonly GqlFilterPreset[], context: PresetContext): GqlFilterPreset[] {
  const simple: GqlFilterPreset[] = [
    ...GQL_FILTER_NAMESPACES.map((ns) => bookmarkedPreset(ns, context)),
    homePersonPreset(context),
  ];
  const byId = new Map(context.savedFilters.map((f) => [f.id, f] as const));
  const resolved = new Map<string, GqlFilterPreset>();
  const resolving = new Set<string>();

  const resolve = (filter: SavedFilter): GqlFilterPreset => {
    const done = resolved.get(filter.id);
    if (done) return done;
    const preset: GqlFilterPreset = {
      id: SAVED_FILTER_PRESET_PREFIX + filter.id, label: `Matches saved filter "${filter.name}"`,
      category: "Saved filters", namespace: filter.namespace, sourceRule: "MatchesFilter",
      expr: "handle == ''", supported: true,
    };
    if (resolving.has(filter.id)) {
      return { ...preset, unavailableReason: `saved filter "${filter.name}" uses itself` };
    }
    resolving.add(filter.id);
    let result: GqlFilterPreset;
    try {
      const used = [...savedFilterIdsIn(filter.tree.root, new Set())]
        .map((id) => byId.get(id))
        .filter((f): f is SavedFilter => f !== undefined)
        .map(resolve);
      result = { ...preset, expr: compileSavedFilter(filter.tree, [...basePresets, ...simple, ...used]) };
    } catch (err) {
      result = { ...preset, unavailableReason: err instanceof Error ? err.message : String(err) };
    }
    resolving.delete(filter.id);
    resolved.set(filter.id, result);
    return result;
  };

  return [...simple, ...context.savedFilters.map(resolve)];
}

function compileSavedFilter(tree: FilterTree, presets: readonly GqlFilterPreset[]): string {
  return combineFilterTree(tree, presets).whereExpr;
}

/** contextPresets() with the app's current bookmarks and home person. */
export function buildContextPresets(
  basePresets: readonly GqlFilterPreset[], savedFilters: readonly SavedFilter[],
): GqlFilterPreset[] {
  return contextPresets(basePresets, {
    bookmarks: bookmarksLoaded() ? (ns) => getBookmarks(ns.toLowerCase()) : null,
    homePersonHandle: getHomePersonHandle(),
    savedFilters,
  });
}
