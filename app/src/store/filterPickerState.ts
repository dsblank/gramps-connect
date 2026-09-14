// Per-view state for the "Filters" picker/editor (FilterPickerDialog.tsx)
// -- the whole arrangement tree (presets, AND/OR groups, NOT flags) --
// kept across the dialog closing/reopening and view switches, the same
// in-memory-only convention searchState.ts uses for FilterBar's own box.
import type { GqlFilterNamespace } from "../data/gqlFilterPresets";
import { createEmptyTree, type FilterTree } from "./goqlFilterTree";

export interface FilterPickerState {
  tree: FilterTree;
}

const state = new Map<string, FilterPickerState>();

/** `namespace` seeds a fresh, empty tree the first time a view is opened
 * this session -- every other read returns whatever's already there
 * regardless of `namespace` (a view's namespace never changes once
 * mounted, so this only ever matters on that first call). */
export function getFilterPickerState(viewKey: string, namespace: GqlFilterNamespace): FilterPickerState {
  return state.get(viewKey) ?? { tree: createEmptyTree(namespace) };
}

export function setFilterPickerState(viewKey: string, tree: FilterTree): void {
  state.set(viewKey, { tree });
}
