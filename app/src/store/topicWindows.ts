// Which Topic chats are open as floating windows right now -- Messenger-
// style chat heads rather than reusing RelatedPanel's shared detail/aside
// pane for a live chat thread (that pane is built for previewing an
// arbitrary linked record, not for a persistent, interactive conversation
// you want to keep open while you keep browsing something else entirely).
// Plain module state + a listener set, same shape as the old dmUi.ts's
// single-thread version of this idea, just supporting more than one window
// open at once.
export interface TopicWindow {
  handle: string;
  minimized: boolean;
}

let windows: TopicWindow[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Opens a floating window for `handle`, or un-minimizes and no-ops if one
 * is already open -- called from DiscussButton.tsx (both the "already
 * linked" and "just created" cases) and NotesSection.tsx's own Topics
 * sub-list row, neither of which should ever end up with two windows for
 * the same topic. Every branch below reassigns `windows` to a fresh array
 * (and, for an existing entry, a fresh object) rather than mutating in
 * place -- useSyncExternalStore's snapshot comparison is `Object.is` on
 * whatever getTopicWindows() returns, so mutating an existing TopicWindow
 * or array element without changing either reference is invisible to it:
 * the click "worked" (the module state did change) but nothing re-rendered
 * until some unrelated re-render happened to read the now-stale-looking
 * snapshot fresh (confirmed live: switching views was enough to make a
 * minimize/expand click that had done nothing suddenly "catch up"). */
export function openTopicWindow(handle: string): void {
  const existing = windows.find((w) => w.handle === handle);
  if (existing) {
    if (!existing.minimized) return;
    windows = windows.map((w) => (w.handle === handle ? { ...w, minimized: false } : w));
  } else {
    windows = [...windows, { handle, minimized: false }];
  }
  notify();
}

export function closeTopicWindow(handle: string): void {
  const next = windows.filter((w) => w.handle !== handle);
  if (next.length === windows.length) return;
  windows = next;
  notify();
}

export function toggleMinimizeTopicWindow(handle: string): void {
  if (!windows.some((w) => w.handle === handle)) return;
  windows = windows.map((w) => (w.handle === handle ? { ...w, minimized: !w.minimized } : w));
  notify();
}

export function getTopicWindows(): TopicWindow[] {
  return windows;
}

export function subscribeTopicWindows(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Bumped whenever a live-sync poll notices any Note change (App.tsx's
// onRemoteNoteChange) -- deliberately unconditional rather than resolving
// each note's own type first (the old dmApi.ts's bumpDmActivity did that
// resolution just for its one DM toast): a FloatingTopicWindow only
// refetches while it's actually mounted, so a spurious bump from an
// unrelated note change costs one wasted request at most, not a
// user-visible problem, and this way onRemoteNoteChange stays a single
// synchronous call with no per-notification GET of its own.
let activityVersion = 0;
const activityListeners = new Set<() => void>();

export function bumpTopicActivity(): void {
  activityVersion++;
  for (const listener of activityListeners) listener();
}

export function subscribeTopicActivity(listener: () => void): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

export function getTopicActivityVersion(): number {
  return activityVersion;
}
