// Per-view search-box state (the raw text typed into FilterBar, plus its
// GOQL toggle), persisted across the remounts App.tsx's
// key={`filter-${view.key}`} triggers on every view switch (see
// FilterBar.tsx's own doc comment). In-memory only, not localStorage like
// columnWidths.ts -- this is "what was I searching" scratch state, not a
// durable preference worth surviving a page reload.
export interface SearchState {
  input: string;
  useGoql: boolean;
  /** True while `input` doesn't match what's actually applied to the view
   * (typed-but-not-submitted, or an applied filter invalidated by toggling
   * useGoql) -- drives FilterBar's "unapplied" highlight. */
  dirty: boolean;
}

const DEFAULT_STATE: SearchState = { input: "", useGoql: false, dirty: false };

const state = new Map<string, SearchState>();

export function getSearchState(viewKey: string): SearchState {
  return state.get(viewKey) ?? DEFAULT_STATE;
}

export function setSearchState(viewKey: string, patch: Partial<SearchState>): void {
  state.set(viewKey, { ...getSearchState(viewKey), ...patch });
}
