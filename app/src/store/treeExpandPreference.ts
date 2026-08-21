// Whether the Tree view's per-node lazy-expand (components/visuals/
// TreeChart.tsx's IntersectionObserver) should fire automatically as a
// boundary marker is panned/zoomed into view, or only when the user clicks
// its marker directly (charts/treeChart.ts's own click handler on the
// marker's hit-rect, which stays available either way). Off by default --
// auto-expand is the norm; this is an escape hatch for whenever it doesn't
// fire (see TreeChart.tsx's own doc comment on IntersectionObserver +
// backgrounded/occluded tabs) or is simply unwanted. Persisted across
// sessions the same localStorage pattern as browserNotifications.ts.
const STORAGE_KEY = "gramps-connect_tree_manual_expand";

export function isManualExpandEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function setManualExpandEnabled(enabled: boolean): void {
  if (enabled) localStorage.setItem(STORAGE_KEY, "true");
  else localStorage.removeItem(STORAGE_KEY);
}
