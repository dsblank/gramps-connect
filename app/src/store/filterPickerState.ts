// Per-view state for the "Filters" picker/editor (FilterPickerDialog.tsx)
// -- just the current *effective* filter tree (whatever tree the active
// Pick/Load/Build panel currently produces), kept across the dialog
// closing/reopening and view switches, the same in-memory-only convention
// searchState.ts uses for FilterBar's own box.
//
// Everything about *how* that tree was arrived at (which panel is active,
// a loaded Saved Filter's own handle/name, the Build panel's own
// remembered tree) is FilterPickerDialog.tsx's own local state -- that
// component is always mounted (ListHeader.tsx renders it unconditionally;
// only the Modal's own visibility toggles), so its state already survives
// a close/reopen on its own. This module exists only because
// ListHeader.tsx is a *sibling* component that needs to read the current
// tree (for its own "Filters (N)" badge, clear button, and summary text)
// without reaching into FilterPickerDialog's internals or mounting its UI.
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
