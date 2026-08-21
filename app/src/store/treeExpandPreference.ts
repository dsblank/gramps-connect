// Whether the Tree view's per-node lazy-expand (components/visuals/
// TreeChart.tsx's IntersectionObserver) should fire automatically as a
// boundary marker is panned/zoomed into view, or only when the user clicks
// its marker directly (charts/treeChart.ts's own click handler on the
// marker's hit-rect, which stays available either way). Manual is the
// default -- auto-expand doesn't always fire (see TreeChart.tsx's own doc
// comment on IntersectionObserver + backgrounded/occluded tabs), and manual
// is simply the preferred mode for now. The toggle for this (TreeView.tsx's
// SHOW_MANUAL_EXPAND_TOGGLE) is currently hidden, but the preference itself
// stays live so re-showing it later needs no changes here. Persisted across
// sessions the same localStorage pattern as browserNotifications.ts.
const STORAGE_KEY = "gramps-connect_tree_manual_expand";

export function isManualExpandEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== "false";
}

export function setManualExpandEnabled(enabled: boolean): void {
  if (enabled) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, "false");
}
