// The External Search window (components/related/ExternalSearchWindow.tsx)
// -- at most one, for one person at a time. Plain module state plus a
// listener set, the same shape as grampletWindows.ts. Opening it from
// another person's panel while it's up switches it to that person (fresh
// search terms) instead of opening a second one.
import { dock, undock } from "./bottomDock";
import { raiseWindow, removeWindow } from "./windowStack";
import type { ObjectDetail } from "./objectDetail";

export const EXTERNAL_SEARCH_WINDOW_ID = "external-search";
export const EXTERNAL_SEARCH_CHIP_WIDTH = 240;

export interface ExternalSearchWindowState {
  detail: ObjectDetail;
  minimized: boolean;
  /** Bumped on every open, so the window starts the person's search terms
   * over even when it's the same person again. */
  generation: number;
}

let state: ExternalSearchWindowState | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function openExternalSearchWindow(detail: ObjectDetail): void {
  state = { detail, minimized: false, generation: (state?.generation ?? 0) + 1 };
  undock(EXTERNAL_SEARCH_WINDOW_ID);
  raiseWindow(EXTERNAL_SEARCH_WINDOW_ID);
  notify();
}

export function closeExternalSearchWindow(): void {
  if (!state) return;
  state = null;
  undock(EXTERNAL_SEARCH_WINDOW_ID);
  removeWindow(EXTERNAL_SEARCH_WINDOW_ID);
  notify();
}

export function setExternalSearchWindowMinimized(minimized: boolean): void {
  if (!state || state.minimized === minimized) return;
  state = { ...state, minimized };
  if (minimized) {
    dock(EXTERNAL_SEARCH_WINDOW_ID, EXTERNAL_SEARCH_CHIP_WIDTH);
  } else {
    undock(EXTERNAL_SEARCH_WINDOW_ID);
    raiseWindow(EXTERNAL_SEARCH_WINDOW_ID);
  }
  notify();
}

export function getExternalSearchWindow(): ExternalSearchWindowState | null {
  return state;
}

export function subscribeExternalSearchWindow(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Brings it to the front (on any pointer-down inside it). */
export function raiseExternalSearchWindow(): void {
  if (state) raiseWindow(EXTERNAL_SEARCH_WINDOW_ID);
}
