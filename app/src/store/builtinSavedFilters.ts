// Built-in saved filters (data/builtinSavedFilters.ts) merged with the
// tree's own Saved Filters. Built-ins are never written to the tree: a
// tree Saved Filter with a built-in's `id` is that tree's edited copy and
// takes the built-in's place, so anything referring to the id ("Matches
// saved filter" rules) follows the edit. Deleting the copy brings the
// built-in back ("Restore original").
//
// Hiding a built-in is per browser and per tree (localStorage), so it
// never writes to the tree either. A hidden built-in still resolves for
// rules that refer to it; it's only left out of "Choose a filter…".
import { BUILTIN_SAVED_FILTERS, type BuiltinSavedFilter } from "../data/builtinSavedFilters";
import { getTreeId } from "../auth/auth";
import { t } from "../i18n/i18n";
import { hashCode } from "./hash";
import type { SavedFilter } from "./savedFilterMedia";
import { STORAGE_KEYS } from "./storageKeys";

const BUILTIN_BY_ID = new Map(BUILTIN_SAVED_FILTERS.map((f) => [f.id, f] as const));

export function findBuiltinSavedFilter(id: string): BuiltinSavedFilter | undefined {
  return BUILTIN_BY_ID.get(id);
}

/** The hash an edited copy stores, to notice when the built-in it was
 * made from changes in a later release. The English name is part of it:
 * renaming a built-in counts as a change. */
export function builtinHash(builtin: BuiltinSavedFilter): string {
  return hashCode(JSON.stringify({ name: builtin.name, namespace: builtin.namespace, tree: builtin.tree }));
}

/** An edited built-in whose built-in has changed since it was edited. */
export function builtinChangedSinceEdit(filter: SavedFilter): boolean {
  if (filter.origin !== "edited-builtin") return false;
  const builtin = findBuiltinSavedFilter(filter.id);
  return !!builtin && filter.builtinHash !== builtinHash(builtin);
}

/** A built-in as a SavedFilter (no handle), with its name translated. */
export function builtinAsSavedFilter(builtin: BuiltinSavedFilter): SavedFilter {
  return { id: builtin.id, name: t(builtin.name), namespace: builtin.namespace, tree: builtin.tree, origin: "builtin" };
}

/** Every built-in not edited on this tree, then the tree's filters (edited
 * built-ins marked as such). Hidden built-ins are included -- see the top
 * comment. */
export function withBuiltinSavedFilters(treeFilters: readonly SavedFilter[]): SavedFilter[] {
  const treeIds = new Set(treeFilters.map((f) => f.id));
  return [
    ...BUILTIN_SAVED_FILTERS.filter((b) => !treeIds.has(b.id)).map(builtinAsSavedFilter),
    ...treeFilters.map((f) => (BUILTIN_BY_ID.has(f.id) ? { ...f, origin: "edited-builtin" as const } : f)),
  ];
}

// --- hidden built-ins (per browser, per tree) --------------------------------

function readHidden(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.hiddenBuiltinFilters);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

export function getHiddenBuiltinIds(): Set<string> {
  const ids = readHidden()[getTreeId() ?? ""];
  return new Set(Array.isArray(ids) ? ids : []);
}

export function setBuiltinHidden(id: string, hidden: boolean): void {
  const all = readHidden();
  const tree = getTreeId() ?? "";
  const ids = new Set(Array.isArray(all[tree]) ? all[tree] : []);
  if (hidden) ids.add(id);
  else ids.delete(id);
  if (ids.size > 0) all[tree] = [...ids];
  else delete all[tree];
  try {
    localStorage.setItem(STORAGE_KEYS.hiddenBuiltinFilters, JSON.stringify(all));
  } catch {
    // Storage blocked: the hide lasts until the dialog reloads.
  }
}

export function showAllBuiltins(): void {
  const all = readHidden();
  delete all[getTreeId() ?? ""];
  try {
    localStorage.setItem(STORAGE_KEYS.hiddenBuiltinFilters, JSON.stringify(all));
  } catch {
    // Storage blocked: nothing was stored to clear.
  }
}
