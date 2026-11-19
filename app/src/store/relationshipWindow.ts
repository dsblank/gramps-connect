// The Relationship window (components/related/RelationshipWindow.tsx) --
// at most one, for one pair of people. It stays on the pair it was opened
// for while you go on browsing, which is what makes it useful for research;
// opening it for another pair switches it to them instead of opening a
// second one. Same shape as externalSearchWindow.ts.
import { dock, undock } from "./bottomDock";
import { raiseWindow, removeWindow } from "./windowStack";
import { logActivity } from "./activityLog";

export const RELATIONSHIP_WINDOW_ID = "relationship";
export const RELATIONSHIP_CHIP_WIDTH = 240;

export interface RelationshipWindowState {
  /** The person the relationship is described from (the Home person, or
   * the first of two selected). */
  from: string;
  /** The person described: "<to> is <from>'s cousin". */
  to: string;
  minimized: boolean;
}

let state: RelationshipWindowState | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function openRelationshipWindow(from: string, to: string): void {
  state = { from, to, minimized: false };
  logActivity({ kind: "relationship", from, to });
  undock(RELATIONSHIP_WINDOW_ID);
  raiseWindow(RELATIONSHIP_WINDOW_ID);
  notify();
}

export function closeRelationshipWindow(): void {
  if (!state) return;
  state = null;
  undock(RELATIONSHIP_WINDOW_ID);
  removeWindow(RELATIONSHIP_WINDOW_ID);
  notify();
}

export function setRelationshipWindowMinimized(minimized: boolean): void {
  if (!state || state.minimized === minimized) return;
  state = { ...state, minimized };
  if (minimized) {
    dock(RELATIONSHIP_WINDOW_ID, RELATIONSHIP_CHIP_WIDTH);
  } else {
    undock(RELATIONSHIP_WINDOW_ID);
    raiseWindow(RELATIONSHIP_WINDOW_ID);
  }
  notify();
}

export function getRelationshipWindow(): RelationshipWindowState | null {
  return state;
}

export function subscribeRelationshipWindow(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Brings it to the front (on any pointer-down inside it). */
export function raiseRelationshipWindow(): void {
  if (state) raiseWindow(RELATIONSHIP_WINDOW_ID);
}
