// A tiny fan-out for TreeChangeNotification, for a consumer that isn't a
// ViewStore -- PyodidePocPanel.tsx's own ad hoc Gramplet-list fetch and
// active-tab re-run, so far -- and so doesn't go through
// registry.ts's getViewStoresForTable(). useLiveSync.ts is still the only
// thing that actually polls (one loop, at the app root, per its own doc
// comment); this just re-broadcasts what it already receives to anyone
// else who wants to react to a live tree change without starting a second
// pollHistory() loop.
import type { TreeChangeNotification } from "./historyPoll";

type Listener = (notification: TreeChangeNotification) => void;

const listeners = new Set<Listener>();

export function publishTreeChange(notification: TreeChangeNotification): void {
  for (const listener of listeners) listener(notification);
}

/** Returns an unsubscribe function, same shape as ViewStore.subscribe. */
export function subscribeTreeChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
