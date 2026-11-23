// Background check of the Gramplet Store: once a day, fetch the catalog and
// tell users who can install Gramplets (canAuthorGramplets()) about
// Gramplets the Store has added since they last looked, and about newer
// versions of ones installed in this tree. It shows a dot on the Gramplets
// menu, a count on "Gramplet Store…", and one in-app toast per batch of
// news. Opening the Store marks everything as seen.
//
// State is per tree and user (installed Gramplets are per tree) in
// localStorage under grampletStoreNewsKey(); the very first check only
// records the catalog's current ids as the baseline, so nobody is told
// "15 new Gramplets" the first time they sign in. The on/off switch is the
// shared one in store/newsCheck.ts.
import { getCurrentUsername, getTreeId } from "../auth/auth";
import { grampletStoreNewsKey } from "../store/storageKeys";
import { isNewsCheckEnabled, isNewsCheckStorageKey, onNewsCheckChange } from "../store/newsCheck";
import { canAuthorGramplets, fetchGramplets } from "./grampletMedia";
import { fetchCatalog, hasCatalogUpdate } from "./grampletStore";
import type { CatalogEntry, Gramplet } from "./types";

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** How often an open tab looks at whether a day has passed -- a cheap
 * timestamp comparison, no request unless one is due. */
const TICK_MS = 60 * 60 * 1000;
/** Let the app finish its own startup requests first. */
const FIRST_TICK_MS = 30 * 1000;

export interface NewsState {
  /** When the catalog was last fetched (ms), successfully. */
  checkedAt: number;
  /** Every catalog id this user has already been shown in this tree. */
  seenIds: string[];
  /** "id@version" of updates already shown. */
  seenUpdates: string[];
  /** News not yet seen: "new:<id>" or "update:<id>@<version>". */
  pending: string[];
}

export interface NewsCounts {
  newCount: number;
  updateCount: number;
}

const updateKey = (entry: CatalogEntry) => `${entry.id}@${entry.version}`;

/** Pure: the state after a check that saw `catalog` and `installed`.
 * `prev` null is the first check ever: everything currently in the
 * catalog becomes the baseline, and only updates are reported. */
export function computeNews(
  catalog: CatalogEntry[],
  installed: Gramplet[],
  prev: NewsState | null,
  now: number,
): NewsState {
  const seenIds = prev ? prev.seenIds : catalog.map((e) => e.id);
  const seenIdSet = new Set(seenIds);
  const seenUpdateSet = new Set(prev?.seenUpdates ?? []);
  const pending: string[] = [];
  for (const entry of catalog) {
    if (!seenIdSet.has(entry.id)) pending.push(`new:${entry.id}`);
  }
  for (const entry of catalog) {
    const gramplet = installed.find((g) => g.sourceId === entry.id);
    if (gramplet && hasCatalogUpdate(gramplet, entry) && !seenUpdateSet.has(updateKey(entry))) {
      pending.push(`update:${updateKey(entry)}`);
    }
  }
  return { checkedAt: now, seenIds, seenUpdates: prev?.seenUpdates ?? [], pending };
}

/** Pure: the state after the user has looked at the Store. */
export function acknowledgeNews(catalog: CatalogEntry[], installed: Gramplet[], now: number): NewsState {
  const seenUpdates = catalog
    .filter((entry) => installed.some((g) => hasCatalogUpdate(g, entry)))
    .map(updateKey);
  return { checkedAt: now, seenIds: catalog.map((e) => e.id), seenUpdates, pending: [] };
}

export function countNews(pending: string[]): NewsCounts {
  const newCount = pending.filter((k) => k.startsWith("new:")).length;
  return { newCount, updateCount: pending.length - newCount };
}

// ---- storage ---------------------------------------------------------------

function newsKey(): string | null {
  const treeId = getTreeId();
  const username = getCurrentUsername();
  return treeId && username ? grampletStoreNewsKey(treeId, username) : null;
}

function readState(): NewsState | null {
  const key = newsKey();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NewsState;
    if (!Array.isArray(parsed.seenIds) || !Array.isArray(parsed.pending)) return null;
    return { ...parsed, seenUpdates: Array.isArray(parsed.seenUpdates) ? parsed.seenUpdates : [] };
  } catch {
    return null;
  }
}

function writeState(state: NewsState): void {
  const key = newsKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // storage blocked/full -- the badge just won't survive a reload
  }
}

// ---- live counts (useSyncExternalStore) ------------------------------------

const ZERO: NewsCounts = { newCount: 0, updateCount: 0 };
let snapshot: NewsCounts = ZERO;
const listeners = new Set<() => void>();

function refreshSnapshot(): void {
  const active = isNewsCheckEnabled() && canAuthorGramplets();
  const next = active ? countNews(readState()?.pending ?? []) : ZERO;
  if (next.newCount !== snapshot.newCount || next.updateCount !== snapshot.updateCount) {
    snapshot = next.newCount === 0 && next.updateCount === 0 ? ZERO : next;
    listeners.forEach((l) => l());
  }
}

export function subscribeGrampletStoreNews(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getGrampletStoreNews(): NewsCounts {
  return snapshot;
}

/** Called by GrampletStorePanel once it has loaded the catalog and the
 * installed list: everything it shows now counts as seen. */
export function acknowledgeGrampletStoreNews(catalog: CatalogEntry[], installed: Gramplet[]): void {
  writeState(acknowledgeNews(catalog, installed, Date.now()));
  refreshSnapshot();
}

// ---- "open the Store" requests from the toast ------------------------------

const openListeners = new Set<() => void>();

/** MenuBar owns the Store dialog; the toast asks it to open. */
export function onOpenGrampletStoreRequest(listener: () => void): () => void {
  openListeners.add(listener);
  return () => openListeners.delete(listener);
}

export function requestOpenGrampletStore(): void {
  openListeners.forEach((l) => l());
}

// ---- the background check --------------------------------------------------

export type NewsNotifier = (counts: NewsCounts) => void;

let notifier: NewsNotifier | null = null;
let inFlight = false;

async function tick(): Promise<void> {
  if (inFlight || !notifier) return;
  refreshSnapshot();
  if (!isNewsCheckEnabled() || !canAuthorGramplets()) return;
  if (typeof document !== "undefined" && document.hidden) return;
  // Read fresh: another tab may have checked (or the user opened the
  // Store there) since this one last looked.
  const prev = readState();
  if (prev && Date.now() - prev.checkedAt < CHECK_INTERVAL_MS) return;
  inFlight = true;
  try {
    const [catalog, installed] = await Promise.all([fetchCatalog(), fetchGramplets()]);
    const next = computeNews(catalog, installed, prev, Date.now());
    writeState(next);
    refreshSnapshot();
    const before = new Set(prev?.pending ?? []);
    const fresh = next.pending.filter((k) => !before.has(k));
    if (fresh.length > 0 && isNewsCheckEnabled()) notifier?.(countNews(fresh));
  } catch (err) {
    // Offline or the Store host is down: routine. checkedAt is left alone,
    // so the next hourly tick tries again.
    console.info("[gramplet store] background check failed:", err);
  } finally {
    inFlight = false;
  }
}

/** Starts the daily check for the signed-in session; returns a stop
 * function. `notify` shows the toast for news found by a check. */
export function startGrampletStoreCheck(notify: NewsNotifier): () => void {
  notifier = notify;
  refreshSnapshot();
  const first = setTimeout(() => void tick(), FIRST_TICK_MS);
  const interval = setInterval(() => void tick(), TICK_MS);
  const onVisible = () => {
    if (!document.hidden) void tick();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === newsKey() || isNewsCheckStorageKey(e.key)) refreshSnapshot();
  };
  const offSwitch = onNewsCheckChange((enabled) => {
    refreshSnapshot();
    if (enabled) void tick();
  });
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("storage", onStorage);
  return () => {
    offSwitch();
    clearTimeout(first);
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("storage", onStorage);
    if (notifier === notify) notifier = null;
  };
}
