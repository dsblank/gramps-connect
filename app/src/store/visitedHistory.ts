// The records this user has opened from a table, newest first, for
// View > Visited (VisitedView.tsx). gramps-web-api keeps no per-user
// history or preferences, so this lives in the browser: one localStorage
// blob holding a list per tree and user (a shared computer can have several
// people signed in, one at a time), the same tree-scoped localStorage
// pattern homePersonPreference.ts uses. It's per browser by nature: the
// desktop app and a laptop each keep their own.
//
// Recorded by useHistorySync.ts, the one place that knows when the route
// has settled on a record the user picked (not a view's automatic first-
// row selection).
import { getCurrentUsername, getTreeId } from "../auth/auth";

const STORAGE_KEY = "gramps-connect_visited";

/** Enough to scroll back a long session; small enough that rewriting the
 * blob on every visit costs nothing. */
export const MAX_VISITS = 200;

/** The object types a visit can be to -- the ten primary Gramps types,
 * the same set the result cards and type tabs cover. Story, Topics,
 * Generated items and the like are app pages over Notes/Media, not records
 * a person "visits", so they're left out. */
const VISITABLE = new Set([
  "person", "family", "event", "place", "repository", "source", "citation", "media", "note", "tag",
]);

export function isVisitable(viewKey: string): boolean {
  return VISITABLE.has(viewKey);
}

export interface Visit {
  /** A VIEWS key, e.g. "person". */
  type: string;
  handle: string;
  /** Unix seconds -- same unit as a record's `change`. */
  at: number;
}

type VisitsByKey = Record<string, Visit[]>;

const listeners = new Set<() => void>();
let version = 0;

function readAll(): VisitsByKey {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all: VisitsByKey): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full or blocked: the visit just isn't remembered.
  }
  version += 1;
  for (const listener of listeners) listener();
}

/** Tree and user: getTreeId() is null outside multi-tree mode, where
 * "unknown" stands for the one tree (homePersonPreference.ts's own key). */
function storageKey(): string {
  return `${getTreeId() ?? "unknown"}:${getCurrentUsername() ?? ""}`;
}

function isVisit(value: unknown): value is Visit {
  const v = value as Visit;
  return !!v && typeof v.type === "string" && typeof v.handle === "string" && typeof v.at === "number";
}

/** This tree and user's visits, newest first. */
export function getVisits(): Visit[] {
  const list = readAll()[storageKey()];
  return Array.isArray(list) ? list.filter(isVisit) : [];
}

/** Puts `type`/`handle` at the top: a revisit moves the record up rather
 * than listing it twice. */
export function recordVisit(type: string, handle: string, at: number = Date.now() / 1000): void {
  if (!isVisitable(type) || !handle) return;
  const all = readAll();
  const key = storageKey();
  const rest = getVisits().filter((v) => !(v.type === type && v.handle === handle));
  all[key] = [{ type, handle, at: Math.floor(at) }, ...rest].slice(0, MAX_VISITS);
  writeAll(all);
}

/** Drops visits to records that no longer exist (deleted, or no longer
 * visible to this user). */
export function forgetVisits(gone: { type: string; handle: string }[]): void {
  if (gone.length === 0) return;
  const drop = new Set(gone.map((v) => `${v.type}:${v.handle}`));
  const all = readAll();
  all[storageKey()] = getVisits().filter((v) => !drop.has(`${v.type}:${v.handle}`));
  writeAll(all);
}

export function clearVisits(): void {
  const all = readAll();
  delete all[storageKey()];
  writeAll(all);
}

export function subscribeVisits(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Bumps on every change, for useSyncExternalStore. */
export function getVisitsVersion(): number {
  return version;
}
