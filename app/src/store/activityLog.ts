// Every research step this user takes, in order, for View > Visited's
// Activity tab (components/visuals/ActivityList.tsx): the records and
// pages they open, the searches and filters they run, the external sites
// they search, the reports and Gramplets they start. Visited
// (visitedHistory.ts) answers "which records have I looked at"; this answers
// "what did I do, and in what order", so it keeps every step rather than
// one entry per record.
//
// Kept in the browser, per tree and user, the same way Visited is:
// gramps-web-api has no per-user storage. The user's own edits are not
// recorded here; the Activity tab reads them from the server's transaction
// history (activityEdits.ts), so they show from any device.
//
// Routes are recorded by useHistorySync.ts (the one place that knows when
// the route has settled); every other kind by the code that performs it.
import { getCurrentUsername, getTreeId } from "../auth/auth";
import type { VisualSubject } from "../hash";
import type { FilterTree } from "./goqlFilterTree";
import { STORAGE_KEYS } from "./storageKeys";

const STORAGE_KEY = STORAGE_KEYS.activity;

/** Weeks of steady research; small enough that rewriting the blob on each
 * step costs little (a few hundred KB at most). */
export const MAX_ACTIVITY = 3000;

/** Unix seconds, like a record's `change` and Visited's `at`. */
type At = { at: number };

export type ActivityEntry = At & (
  /** A page settled on: a record (`handle`), a list (neither), or a visual,
   * possibly scoped to a record (`subject`). */
  | { kind: "route"; viewKey: string; handle?: string; subject?: VisualSubject }
  /** A site opened from the External Search window. */
  | { kind: "external"; site: string; terms: string; url: string }
  /** A list's own search box submitted (FilterBar.tsx). */
  | { kind: "search"; viewKey: string; text: string; useGoql: boolean; whereExpr: string }
  /** View > Search all submitted. */
  | { kind: "searchAll"; query: string; type: string | null }
  /** The Filters dialog applied (FilterPickerDialog.tsx). */
  | { kind: "filter"; viewKey: string; summary: string; tree: FilterTree; whereExpr: string }
  /** The Relationship window opened between two people. */
  | { kind: "relationship"; from: string; to: string }
  | { kind: "report"; name: string; desc: string }
  | { kind: "gramplet"; id: string; name: string }
  /** The tab was hidden: not shown, only ends the step before it. */
  | { kind: "away" }
);

/** An entry as passed to logActivity: `at` is filled in. */
export type NewActivity = ActivityEntry extends infer E ? E extends At ? Omit<E, "at"> : never : never;

type ByKey = Record<string, ActivityEntry[]>;

const listeners = new Set<() => void>();
let version = 0;

function readAll(): ByKey {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(all: ByKey): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full or blocked: the step just isn't remembered.
  }
  version += 1;
  for (const listener of listeners) listener();
}

/** Same key as visitedHistory.ts: tree ("unknown" outside multi-tree mode)
 * and user. */
function storageKey(): string {
  return `${getTreeId() ?? "unknown"}:${getCurrentUsername() ?? ""}`;
}

function isEntry(value: unknown): value is ActivityEntry {
  const v = value as ActivityEntry;
  return !!v && typeof v.kind === "string" && typeof v.at === "number";
}

/** This tree and user's steps, oldest first. */
export function getActivity(): ActivityEntry[] {
  const list = readAll()[storageKey()];
  return Array.isArray(list) ? list.filter(isEntry) : [];
}

function sameRoute(a: ActivityEntry | undefined, b: NewActivity): boolean {
  return (
    a?.kind === "route" && b.kind === "route" && a.viewKey === b.viewKey &&
    (a.handle ?? null) === (b.handle ?? null) &&
    (a.subject?.type ?? null) === (b.subject?.type ?? null) &&
    (a.subject?.handle ?? null) === (b.subject?.handle ?? null)
  );
}

/** Appends a step. A route equal to the last step, or "away" right after
 * another "away", adds nothing: coming back to the tab is not a new step. */
export function logActivity(entry: NewActivity, at: number = Date.now() / 1000): void {
  if (!getCurrentUsername()) return;
  const all = readAll();
  const key = storageKey();
  const stored = all[key];
  const list = Array.isArray(stored) ? stored.filter(isEntry) : [];
  const last = list[list.length - 1];
  if (sameRoute(last, entry)) return;
  if (entry.kind === "away" && (!last || last.kind === "away")) return;
  list.push({ ...entry, at: Math.floor(at) } as ActivityEntry);
  all[key] = list.slice(-MAX_ACTIVITY);
  writeAll(all);
}

/** Records "away" while the tab is hidden, so the step before it isn't
 * credited with the time spent elsewhere. Returns the matching stop. */
export function installActivityAwayTracking(): () => void {
  function onVisibility() {
    if (document.visibilityState === "hidden") logActivity({ kind: "away" });
  }
  document.addEventListener("visibilitychange", onVisibility);
  return () => document.removeEventListener("visibilitychange", onVisibility);
}

export function clearActivity(): void {
  const all = readAll();
  delete all[storageKey()];
  writeAll(all);
}

export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Bumps on every change, for useSyncExternalStore. */
export function getActivityVersion(): number {
  return version;
}
