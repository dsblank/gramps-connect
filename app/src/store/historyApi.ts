// GET /api/transactions/history/objects/<obj_class>/<obj_handle>/ --
// gramps-web-api v3.22.0's indexed per-object change history (PR #956/
// #970), the after-the-fact complement to historyPoll.ts's tree-wide live
// sync: "who changed this record, when, and how" rather than "notify me
// the moment something changes". Same endpoint family/conventions as
// historyPoll.ts (page/pagesize, ETag-capable) but consumed one-shot per
// HistoryButton open/Load-more click rather than polled, so this module
// skips the ETag/If-None-Match dance -- there's no repeated identical
// request here for a 304 to short-circuit.
import { API_BASE } from "../config";
import type { ViewConfig } from "./views";

/** ViewConfig.key -> gramps-web-api's obj_class, for the real Gramps
 * record types this app can show a history for. draftStack.ts has a
 * same-shaped CLASS_NAME map, but it's private to that module and omits
 * "media" (media edits don't go through the draft stack) -- kept separate
 * rather than exporting/coupling to it. Deliberately excludes "generated",
 * "topics", "story", "topic-message": app-level constructs layered on
 * Note/Media, not plain edited records (the same exclusion DeleteButton.tsx
 * already makes for "generated"). */
export const VIEW_KEY_TO_OBJ_CLASS: Partial<Record<string, string>> = {
  person: "Person",
  family: "Family",
  event: "Event",
  place: "Place",
  repository: "Repository",
  source: "Source",
  citation: "Citation",
  media: "Media",
  note: "Note",
  tag: "Tag",
};

export function objClassFor(view: ViewConfig): string | undefined {
  return VIEW_KEY_TO_OBJ_CLASS[view.key];
}

/** A single change to one object, as gramps-web-api's ObjectChangeSchema
 * returns it (only the fields this app reads). */
export interface ObjectChange {
  id: number;
  /** Nullable: no covering transaction was found for this change (see
   * gramps-web-api PR #970's doc comment) -- not used yet in this app
   * (there's no tree-wide transaction-detail view to link to), carried
   * through for a future "view full transaction"/undo entry point. */
  transaction_id: number | null;
  obj_class: string;
  obj_handle: string;
  /** 0 = add, 1 = update, 2 = delete. */
  trans_type: number;
  /** Unix seconds -- same shape as historyPoll.ts's/views.ts's `change`
   * column, so formatChange/formatChangeTitle apply unchanged. */
  timestamp: number;
  /** Resolved server-side (fix_transaction_user); null/absent for a
   * system-driven change with no acting user. */
  connection?: { user?: { name: string | null } | null } | null;
  /** Only present when requested via old=true/new=true. */
  old_data?: Record<string, unknown> | null;
  new_data?: Record<string, unknown> | null;
}

export interface ObjectHistoryPage {
  changes: ObjectChange[];
  /** Total changes across all pages, from the X-Total-Count header. */
  count: number;
}

/** Fetches one page of an object's change history, newest first, with the
 * raw old/new object data included (the diff dialog needs it, and pages
 * are small enough -- 10-ish rows -- that this beats inventing a second
 * single-change lookup; the endpoint has no by-id GET). */
export async function fetchObjectHistory(
  token: string,
  objClass: string,
  objHandle: string,
  { page, pagesize }: { page: number; pagesize: number }
): Promise<ObjectHistoryPage> {
  const params = new URLSearchParams({
    old: "true",
    new: "true",
    sort: "-id",
    page: String(page),
    pagesize: String(pagesize),
  });
  // No trailing slash before the query string -- unlike the tree-wide
  // /transactions/history/ endpoint, this route is registered without one
  // (gramps-web-api's api/__init__.py), and Flask 404s a request that adds
  // one rather than redirecting (strict_slashes only auto-redirects the
  // other direction: a slash-terminated route hit without the slash).
  const res = await fetch(`${API_BASE}/api/transactions/history/objects/${objClass}/${objHandle}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`object history fetch failed: ${res.status}`);
  const changes: ObjectChange[] = await res.json();
  const count = Number(res.headers.get("X-Total-Count") ?? changes.length);
  return { changes, count };
}
