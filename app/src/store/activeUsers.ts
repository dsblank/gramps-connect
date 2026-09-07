// Tracks which other users have recently edited the current tree, as a
// client-only approximation of "who's active" -- gramps-web-api has no
// session/heartbeat/presence concept at all (no last_login, no logout
// endpoint even), so there's no way to see users who are only *reading*.
// This piggybacks on the poll useLiveSync.ts already runs (historyPoll.ts,
// every 5s) rather than adding any new request: every notification's
// changedBy is recorded here regardless of table, and getActiveUsers()
// reports whoever changed something within the trailing window. See
// useLiveSync.ts for where recordActivity() is called.
import { getCurrentUsername } from "../auth/auth";

// How long a user stays "active" after their last recorded edit. A rolling
// decay, not a real online/offline signal -- there's no logout event to key
// off of, so someone closing their tab just ages out of this window instead
// of disappearing immediately.
const ACTIVE_WINDOW_MS = 5 * 60_000;

// How often stale entries are pruned and listeners notified so the UI's
// avatars actually age out on their own, not just on the next unrelated
// edit. Client-only bookkeeping -- no network call.
const PRUNE_INTERVAL_MS = 30_000;

const lastSeen = new Map<string, number>();
const listeners = new Set<() => void>();
let pruneTimer: ReturnType<typeof setInterval> | null = null;

// useSyncExternalStore requires getSnapshot() to return a referentially
// stable value between calls when nothing changed (it compares via
// Object.is) -- building the array fresh on every call, as getActiveUsers()
// used to, fails that and React throws "The result of getSnapshot should be
// cached to avoid an infinite loop". So the sorted/filtered list is instead
// computed once per mutation, here, and getActiveUsers() just returns the
// cached reference.
let snapshot: string[] = [];

function recomputeSnapshot(): void {
  const self = getCurrentUsername();
  snapshot = Array.from(lastSeen.entries())
    .filter(([username]) => username !== self)
    .sort((a, b) => b[1] - a[1])
    .map(([username]) => username);
}

function notify(): void {
  recomputeSnapshot();
  for (const listener of listeners) listener();
}

function prune(now: number): void {
  let changed = false;
  for (const [username, seenAt] of lastSeen) {
    if (now - seenAt > ACTIVE_WINDOW_MS) {
      lastSeen.delete(username);
      changed = true;
    }
  }
  if (changed) notify();
}

/** Records that `username` just changed something in the tree. Called from
 * useLiveSync.ts's notification handler for every table, not just Notes. */
export function recordActivity(username: string): void {
  lastSeen.set(username, Date.now());
  notify();
}

/** The other users who've edited within the trailing window, most-recent
 * first. Excludes the signed-in user -- this is meant for "who else is
 * active," not a mirror of your own UserMenu avatar. A cached reference
 * (see `snapshot` above), stable across calls until the next mutation. */
export function getActiveUsers(): string[] {
  return snapshot;
}

/** useSyncExternalStore subscription. Lazily starts the prune interval on
 * the first subscriber and stops it once the last one unsubscribes, so this
 * module has no background timer running before anything renders it. */
export function subscribeActiveUsers(listener: () => void): () => void {
  listeners.add(listener);
  if (pruneTimer === null) {
    pruneTimer = setInterval(() => prune(Date.now()), PRUNE_INTERVAL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && pruneTimer !== null) {
      clearInterval(pruneTimer);
      pruneTimer = null;
    }
  };
}
