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

// FloatingTopicWindows.tsx gives every window the same fixed width
// regardless of minimized/expanded state and always slots the
// newest-opened one into the prime corner spot, pushing each older one
// further left -- with no cap, opening enough discussions at once pushes
// the oldest ones off the edge of the screen entirely, with no scrollbar
// and no way back short of closing the newer ones in front of them
// (confirmed live). Closing (not minimizing) the oldest is what actually
// prevents that: a minimized window still occupies its own full-width
// slot, so minimizing alone wouldn't free anything up.
const MAX_OPEN_WINDOWS = 5;

function notify(): void {
  for (const listener of listeners) listener();
}

/** Opens a floating window for `handle`, or un-minimizes and no-ops if one
 * is already open -- called from DiscussButton.tsx (both the "already
 * linked" and "just created" cases) and NotesSection.tsx's own Topics
 * sub-list row, neither of which should ever end up with two windows for
 * the same topic. Opening a genuinely new one beyond MAX_OPEN_WINDOWS
 * silently closes the single oldest (least-recently-opened) window to
 * make room -- un-minimizing an already-open window never evicts anything,
 * since the total open count doesn't change. Every branch below reassigns
 * `windows` to a fresh array (and, for an existing entry, a fresh object)
 * rather than mutating in place -- useSyncExternalStore's snapshot
 * comparison is `Object.is` on whatever getTopicWindows() returns, so
 * mutating an existing TopicWindow or array element without changing
 * either reference is invisible to it: the click "worked" (the module
 * state did change) but nothing re-rendered until some unrelated
 * re-render happened to read the now-stale-looking snapshot fresh
 * (confirmed live: switching views was enough to make a minimize/expand
 * click that had done nothing suddenly "catch up"). */
export function openTopicWindow(handle: string): void {
  const existing = windows.find((w) => w.handle === handle);
  if (existing) {
    if (!existing.minimized) return;
    windows = windows.map((w) => (w.handle === handle ? { ...w, minimized: false } : w));
  } else {
    const next = [...windows, { handle, minimized: false }];
    windows = next.length > MAX_OPEN_WINDOWS ? next.slice(next.length - MAX_OPEN_WINDOWS) : next;
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
