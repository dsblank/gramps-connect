// Pure: turns the browser's step log (activityLog.ts) and the server's edits
// (activityEdits.ts) into what View > Visited's Activity tab draws --
// sessions of steps, newest first, each step with how long it lasted and
// runs of alike steps folded together.
import type { ActivityEntry } from "./activityLog";
import type { EditEntry } from "./activityEdits";

/** A pause longer than this ends a session, and caps how long one step can
 * be counted: nobody looks at one record for an hour without touching
 * anything, they walked away. */
export const SESSION_GAP_SECONDS = 30 * 60;

export type TimelineEntry = ActivityEntry | EditEntry;

export interface TimelineItem {
  entry: TimelineEntry;
  /** Seconds until the next step (or until the tab was hidden), when known
   * and capped by SESSION_GAP_SECONDS. Never set on an edit: an edit
   * happens while looking at a record, it doesn't move on from it. */
  duration?: number;
}

export interface Session {
  start: number;
  end: number;
  /** Newest first. */
  items: TimelineItem[];
}

const HIDDEN_PAGES = new Set(["visited", "home", "search"]);

/** Steps kept for timing but not listed: being away, Home, this page
 * itself, and Search all's empty page. */
export function isHidden(entry: TimelineEntry): boolean {
  if (entry.kind === "away") return true;
  // Search all's page on its own: the search run there is its own step.
  return entry.kind === "route" && !entry.handle && !entry.subject && HIDDEN_PAGES.has(entry.viewKey);
}

/** The newest step has no duration: nothing after it says when it ended. */
export function buildSessions(log: ActivityEntry[], edits: EditEntry[]): Session[] {
  // Stable: a local step and an edit in the same second keep the step first.
  const all: TimelineEntry[] = [...log, ...edits].sort((a, b) => a.at - b.at);
  const steps = all.filter((e) => e.kind !== "edit");
  const durations = new Map<TimelineEntry, number>();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (isHidden(step)) continue;
    const nextAt = i + 1 < steps.length ? steps[i + 1].at : null;
    if (nextAt === null) continue;
    durations.set(step, Math.max(0, Math.min(nextAt, step.at + SESSION_GAP_SECONDS) - step.at));
  }

  const sessions: Session[] = [];
  let current: TimelineItem[] = [];
  let lastAt: number | null = null;
  const flush = () => {
    if (current.length === 0) return;
    const start = current[0].entry.at;
    const end = Math.max(...current.map((it) => it.entry.at + (it.duration ?? 0)));
    sessions.push({ start, end, items: current.reverse() });
    current = [];
  };
  for (const entry of all) {
    // An "away" ends the time count but not the session: a short trip to
    // another tab is still the same sitting.
    if (lastAt !== null && entry.at - lastAt > SESSION_GAP_SECONDS) flush();
    lastAt = entry.at;
    if (isHidden(entry)) continue;
    current.push({ entry, duration: durations.get(entry) });
  }
  flush();
  return sessions.reverse();
}

/** What makes neighbouring items one run: opening records of one type, or
 * editing one record. Anything else stands alone. */
export function runKey(entry: TimelineEntry): string | null {
  if (entry.kind === "route" && entry.handle) return `open:${entry.viewKey}`;
  if (entry.kind === "edit" && entry.changes.length > 0) {
    const first = entry.changes[0];
    return `edit:${first.type}:${first.handle}`;
  }
  return null;
}

export type TimelineRow =
  | { kind: "item"; item: TimelineItem }
  | { kind: "run"; key: string; items: TimelineItem[] };

/** Folds `minRun` or more neighbouring items with the same runKey into one
 * row, keeping the order. */
export function collapseRuns(items: TimelineItem[], minRun = 3): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let i = 0;
  while (i < items.length) {
    const key = runKey(items[i].entry);
    let j = i + 1;
    if (key !== null) while (j < items.length && runKey(items[j].entry) === key) j++;
    // Repeated edits of one record fold from two: that's one piece of work.
    const needed = key?.startsWith("edit:") ? 2 : minRun;
    if (key !== null && j - i >= needed) {
      rows.push({ kind: "run", key, items: items.slice(i, j) });
    } else {
      for (let k = i; k < j; k++) rows.push({ kind: "item", item: items[k] });
    }
    i = j;
  }
  return rows;
}

/** "45 s", "12 min", "1 h 5 min". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
