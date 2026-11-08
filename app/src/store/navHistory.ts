// Whether the header's Back/Forward buttons (components/HistoryNav.tsx)
// have anywhere to go. They step through the browser's own history -- every
// view switch and row selection is already a real entry (useHistorySync.ts
// sets location.hash) -- so going is just history.back()/forward(). What the
// History API can't say is whether there *is* a previous/next entry, and the
// Navigation API that can (navigation.canGoBack) isn't in WKWebView, which
// the macOS desktop app runs in. So each entry gets its position stamped
// into history.state:
//
//  - an entry with no stamp is a new one: one past the current position,
//    and the newest (a new entry drops whatever Forward could have reached);
//  - an entry with a stamp is one Back/Forward (or a reload) returned to.
//
// Back stops at position 0, the first entry of this page load, so the
// button never takes the user out of the app; the browser's own Back still
// can. The newest position is kept in sessionStorage so a reload partway
// back still knows Forward has somewhere to go.
import { STORAGE_KEYS } from "./storageKeys";

const MAX_KEY = STORAGE_KEYS.navMax;

export interface NavHistorySnapshot {
  canGoBack: boolean;
  canGoForward: boolean;
}

let current = 0;
let max = 0;
let snapshot: NavHistorySnapshot = { canGoBack: false, canGoForward: false };
const listeners = new Set<() => void>();

function readStamp(): number | null {
  const state = window.history.state as { navIdx?: unknown } | null;
  return state && typeof state.navIdx === "number" ? state.navIdx : null;
}

/** Same URL, so no hashchange fires; keeps whatever else is in the state. */
function stamp(idx: number): void {
  const state = window.history.state;
  const base = state && typeof state === "object" ? state : {};
  window.history.replaceState({ ...base, navIdx: idx }, "", window.location.href);
}

function readMax(): number {
  try {
    const n = Number(sessionStorage.getItem(MAX_KEY));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function saveMax(): void {
  try {
    sessionStorage.setItem(MAX_KEY, String(max));
  } catch {
    // Forward just can't survive a reload without it.
  }
}

function update(): void {
  const next = { canGoBack: current > 0, canGoForward: current < max };
  if (next.canGoBack !== snapshot.canGoBack || next.canGoForward !== snapshot.canGoForward) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
}

function onHashChange(): void {
  const idx = readStamp();
  if (idx === null) {
    current += 1;
    max = current;
    stamp(current);
  } else {
    current = idx;
    max = Math.max(max, idx);
  }
  saveMax();
  update();
}

/** Starts tracking; returns the matching stop. Called once by App.tsx. */
export function installNavHistory(): () => void {
  const idx = readStamp();
  if (idx === null) {
    // A fresh load (not a reload or a return to an entry stamped earlier):
    // the start of this tab's in-app history.
    current = 0;
    max = 0;
    stamp(0);
  } else {
    current = idx;
    max = Math.max(readMax(), idx);
  }
  saveMax();
  update();
  window.addEventListener("hashchange", onHashChange);
  return () => window.removeEventListener("hashchange", onHashChange);
}

export function getNavHistorySnapshot(): NavHistorySnapshot {
  return snapshot;
}

export function subscribeNavHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function goBack(): void {
  if (snapshot.canGoBack) window.history.back();
}

export function goForward(): void {
  if (snapshot.canGoForward) window.history.forward();
}
