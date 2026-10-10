// The row of floating cards along the bottom edge of the screen, right to
// left: Topic chat windows (FloatingTopicWindows.tsx, docked whether
// expanded or minimized) and minimized Gramplet windows' chips
// (pyodidePoc/GrampletWindows.tsx). Both kinds anchor to the bottom-right
// corner, so each needs to know how much room every *other* docked card
// takes up -- this one shared, ordered list is that, instead of two stores
// that each think they own the corner and overlap. Each card still
// positions itself independently (`position: fixed` at its own offset --
// see FloatingTopicWindow.tsx's doc comment for why not a shared flex row).
//
// Order is dock order: the most recently docked card sits closest to the
// corner, pushing the older ones further left.

export const DOCK_MARGIN = 16;
export const DOCK_GAP = 12;

export interface DockEntry {
  id: string;
  width: number;
}

let entries: DockEntry[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Adds `id` at the corner end. A no-op if it's already docked -- it keeps
 * its place (un-minimizing a Topic window shouldn't reshuffle the row). */
export function dock(id: string, width: number): void {
  if (entries.some((entry) => entry.id === id)) return;
  entries = [...entries, { id, width }];
  notify();
}

export function undock(id: string): void {
  const next = entries.filter((entry) => entry.id !== id);
  if (next.length === entries.length) return;
  entries = next;
  notify();
}

/** A fresh array on every change (useSyncExternalStore compares by
 * reference), never mutated in place. */
export function getDock(): DockEntry[] {
  return entries;
}

export function subscribeDock(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Each docked id's distance from the right edge of the viewport, newest
 * (closest to the corner) first. */
export function dockOffsets(dockEntries: DockEntry[]): Map<string, number> {
  const offsets = new Map<string, number>();
  let right = DOCK_MARGIN;
  for (let i = dockEntries.length - 1; i >= 0; i--) {
    offsets.set(dockEntries[i].id, right);
    right += dockEntries[i].width + DOCK_GAP;
  }
  return offsets;
}
