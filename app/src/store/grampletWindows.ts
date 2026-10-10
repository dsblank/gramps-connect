// Which (window) Gramplets are open right now, in their floating windows
// (pyodidePoc/GrampletWindows.tsx / GrampletWindow.tsx) -- plain module state plus a
// listener set, the same shape as topicWindows.ts. Each window owns
// its own Pyodide worker and run state (GrampletWindow.tsx); this module
// only holds what the windows need to agree on between them: which are
// open, which are minimized (their chip's place in the shared bottom dock),
// stacking order, which are running (for the leave-page warning), and
// which idle workers to release to bound memory.
import { dock, undock } from "./bottomDock";
import { grampletKind } from "../pyodidePoc/grampletManifest";
import type { Gramplet } from "../pyodidePoc/types";

/** Unlike topicWindows.ts, opening one more never silently closes the
 * oldest -- that would kill a run in progress. The caller tells the user
 * to close one instead (see openGrampletWindow()'s "full"). */
export const MAX_GRAMPLET_WINDOWS = 5;

/** A minimized window's chip width -- its share of the bottom dock. */
export const GRAMPLET_CHIP_WIDTH = 240;

/** Finished windows whose Pyodide worker is kept alive (so an st.* widget
 * click or Run again is instant) -- each is tens to a few hundred MB.
 * Beyond this many, the least recently used idle worker is released; that
 * window boots a fresh one on its next run. A *running* window's worker is
 * never released. */
export const MAX_IDLE_WORKERS = 2;

export interface GrampletWindowEntry {
  gramplet: Gramplet;
  minimized: boolean;
  /** Bumped by restartGrampletWindow() -- part of the window's React key
   * (GrampletWindows.tsx), so a change remounts it: old worker gone, fresh
   * run of the new code. */
  generation: number;
}

let windows: GrampletWindowEntry[] = [];
/** Gramplet ids, bottom-most first -- the last one is drawn on top. */
let zOrder: string[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function grampletDockId(grampletId: string): string {
  return `gramplet:${grampletId}`;
}

function raise(grampletId: string): void {
  zOrder = [...zOrder.filter((id) => id !== grampletId), grampletId];
}

/** Opens `gramplet`'s window, or focuses (and un-minimizes) it if it's
 * already open -- one window per Gramplet, never two. An already-open
 * window also picks up `gramplet` itself, so an edit saved since it was
 * opened applies to its next run. Returns "full" without opening anything
 * when MAX_GRAMPLET_WINDOWS are already open. */
export function openGrampletWindow(gramplet: Gramplet): "opened" | "focused" | "full" {
  const existing = windows.find((w) => w.gramplet.id === gramplet.id);
  if (existing) {
    windows = windows.map((w) => (w === existing ? { ...w, gramplet, minimized: false } : w));
    undock(grampletDockId(gramplet.id));
    raise(gramplet.id);
    notify();
    return "focused";
  }
  if (windows.length >= MAX_GRAMPLET_WINDOWS) return "full";
  windows = [...windows, { gramplet, minimized: false, generation: 0 }];
  raise(gramplet.id);
  notify();
  return "opened";
}

/** After `gramplet` was edited and saved (the window's own edit pencil):
 * its open window starts over with the saved version -- the same as
 * closing it and picking it from the menu again, without losing its
 * place. Closes it instead if the edit made it a View Gramplet, which
 * doesn't belong in a window. A no-op if it isn't open. */
export function restartGrampletWindow(gramplet: Gramplet): void {
  if (!windows.some((w) => w.gramplet.id === gramplet.id)) return;
  if (grampletKind(gramplet) !== "window") {
    closeGrampletWindow(gramplet.id);
    return;
  }
  windows = windows.map((w) =>
    w.gramplet.id === gramplet.id ? { gramplet, minimized: false, generation: w.generation + 1 } : w
  );
  undock(grampletDockId(gramplet.id));
  raise(gramplet.id);
  notify();
}

export function closeGrampletWindow(grampletId: string): void {
  const next = windows.filter((w) => w.gramplet.id !== grampletId);
  if (next.length === windows.length) return;
  windows = next;
  zOrder = zOrder.filter((id) => id !== grampletId);
  undock(grampletDockId(grampletId));
  running.delete(grampletId);
  forgetWorker(grampletId);
  notify();
}

/** Minimizing docks the window's chip at the bottom of the screen
 * (store/bottomDock.ts, shared with Topic windows); restoring undocks it
 * and brings the window to the front. */
export function setGrampletWindowMinimized(grampletId: string, minimized: boolean): void {
  const entry = windows.find((w) => w.gramplet.id === grampletId);
  if (!entry || entry.minimized === minimized) return;
  windows = windows.map((w) => (w === entry ? { ...w, minimized } : w));
  if (minimized) {
    dock(grampletDockId(grampletId), GRAMPLET_CHIP_WIDTH);
  } else {
    undock(grampletDockId(grampletId));
    raise(grampletId);
  }
  notify();
}

/** Brings a window to the front (on any pointer-down inside it). */
export function focusGrampletWindow(grampletId: string): void {
  if (zOrder[zOrder.length - 1] === grampletId || !zOrder.includes(grampletId)) return;
  raise(grampletId);
  notify();
}

export function getGrampletWindows(): GrampletWindowEntry[] {
  return windows;
}

/** Stacking position, 0 = bottom-most. */
export function getGrampletWindowZOrder(): string[] {
  return zOrder;
}

export function subscribeGrampletWindows(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Which windows have a run in progress -- read by GrampletWindows.tsx's
// beforeunload warning (closing the tab kills every run).
const running = new Set<string>();

export function setGrampletRunning(grampletId: string, isRunning: boolean): void {
  if (isRunning) running.add(grampletId);
  else running.delete(grampletId);
}

export function isAnyGrampletRunning(): boolean {
  return running.size > 0;
}

// Idle workers, least recently used first -- see MAX_IDLE_WORKERS.
let idleWorkers: { grampletId: string; release: () => void }[] = [];

/** A window's run finished and its worker is now idle. `release` is called
 * (at most once) if it falls out of the MAX_IDLE_WORKERS most recently
 * used -- it should terminate the worker and forget it. */
export function markWorkerIdle(grampletId: string, release: () => void): void {
  idleWorkers = [...idleWorkers.filter((w) => w.grampletId !== grampletId), { grampletId, release }];
  while (idleWorkers.length > MAX_IDLE_WORKERS) {
    const [oldest, ...rest] = idleWorkers;
    idleWorkers = rest;
    oldest.release();
  }
}

/** A window's worker is busy again (or gone): it's no longer a candidate
 * for release. */
export function forgetWorker(grampletId: string): void {
  idleWorkers = idleWorkers.filter((w) => w.grampletId !== grampletId);
}
