// Talks to gramps-web-api's fast, SQL-pushed-down POST /api/<type>/query/
// endpoints (keyset-paginated, where_expr filtering, count support) --
// ported from the original Layer 2/3 spike's browser.ts (fetchPage; since
// removed, see git history).
import { API_BASE } from "../config";
import { toSelectEntry } from "./sql";
import type { ColumnConfig, OrderBy, ViewConfig } from "./views";
import { apiFetch } from "./apiFetch";

// Server-side max (see QueryBodyArgs.limit's Range(min=1, max=1000) in
// gramps-web-api's object_query.py) -- fewer round trips for a fixed
// dataset size than the default limit=50.
export const PAGE_SIZE = 1000;

export type QueryItem = Record<string, unknown> & { handle: string };

export interface QueryPage {
  items: QueryItem[];
  next_after: string | null;
}

export async function login(username: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await apiFetch(`${API_BASE}/api/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(`login failed: ${res.status} ${await res.text()}`);
  }
  const { access_token, refresh_token } = await res.json();
  return { accessToken: access_token as string, refreshToken: refresh_token as string };
}

/** Exchanges the (long-lived) refresh token for a new access token. Gramps-
 * web-api rejects this with 401/422 once the refresh token itself is
 * invalid, or 403 (v3.25.0+) once a password change or disabling the user
 * has ended it -- the caller's only recourse at that point is a
 * fresh login. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await apiFetch(`${API_BASE}/api/token/refresh/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${refreshToken}` },
  });
  if (!res.ok) {
    throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  }
  const { access_token } = await res.json();
  return access_token as string;
}

/** What each tree-locking task (gramps-web-api v3.24.0+'s LOCK_WRITE and
 * search-index locks) is called in a "something is already running"
 * message -- a phrase that fits "<it> is still running". */
const LOCKED_TASK_LABELS: Record<string, string> = {
  import_file: "An import",
  import_media_archive: "A media import",
  restore_backup: "A backup restore",
  restore_backup_archive: "A backup restore",
  create_backup: "A backup",
  check_repair_database: "Check and Repair",
  upgrade_database_schema: "A database upgrade",
  delete_objects: "A delete",
  search_reindex_full: "A search index rebuild",
  // gramps-web-api v3.24.0 only; v3.25.0 removed semantic search
  search_reindex_full_semantic: "A search index rebuild",
};

/** A 409 `task_locked` (gramps-web-api v3.24.0+: a tree-changing task, or
 * a second full reindex, while another one runs) names only the blocking
 * task's id -- looked up here so the message can say what it is, who
 * started it and when. Falls back to the server's own message if the
 * lookup fails (e.g. a Member can't see another user's task). */
export async function describeTaskLocked(serverMessage: string, taskId: unknown): Promise<string> {
  const fallback = `${serverMessage}. Try again once it has finished.`;
  if (typeof taskId !== "string") return fallback;
  try {
    // Dynamic: auth.ts imports this module, so a static import would be a cycle.
    const { getToken, getCurrentUsername } = await import("../auth/auth");
    const res = await apiFetch(`${API_BASE}/api/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${await getToken()}` },
    });
    if (!res.ok) return fallback;
    const task = (await res.json()) as { name?: string; user_name?: string; created_at?: string };
    const what = (task.name && LOCKED_TASK_LABELS[task.name]) || "Another task";
    const by = task.user_name && task.user_name !== getCurrentUsername() ? ` by ${task.user_name}` : "";
    const started = task.created_at ? new Date(task.created_at) : null;
    const at = started && !Number.isNaN(started.getTime())
      ? ` at ${started.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "";
    const startedPart = by || at ? ` (started${by}${at})` : "";
    return `${what}${startedPart} is still running on this tree. Try again once it has finished.`;
  } catch {
    return fallback;
  }
}

export async function parseErrorMessage(res: Response): Promise<string> {
  // QueryLangError etc. come back as {"error": {"code", "message"}} --
  // surface .message (e.g. "invalid syntax: ...") rather than the raw
  // envelope, falling back to the raw body if it's not that shape.
  const body = await res.text();
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error?.type === "task_locked" && typeof parsed.error.message === "string") {
      return describeTaskLocked(parsed.error.message, parsed.error.task?.id);
    }
    if (typeof parsed?.error?.message === "string") return parsed.error.message;
    // A bare flask abort(422) etc. carries no message, just flask-smorest's
    // default {"code": 422, "status": "Unprocessable Entity"} -- a status
    // line reads better than that envelope (e.g. report options the server
    // rejects without saying why, gramps-web-api >= v3.23.0's #1007).
    if (typeof parsed?.message === "string") return parsed.message;
    if (typeof parsed?.status === "string") {
      return `Request rejected by the server (${res.status} ${parsed.status})`;
    }
    return body;
  } catch {
    // A gateway/app-server failure (e.g. gunicorn killing a worker mid
    // request on a slow/large upload -- see deploy/docker-compose.yml's
    // GUNICORN_TIMEOUT) returns an HTML error page, not JSON. Dumping
    // that markup verbatim into a notification/dialog is worse than a
    // plain status line.
    if (/^\s*<(!doctype|html)/i.test(body)) {
      return `Server error (${res.status} ${res.statusText || "request failed"})`;
    }
    return body;
  }
}

export async function fetchPage(
  view: ViewConfig,
  token: string,
  after: string | null,
  wantCount: boolean,
  whereExpr: string | null,
  orderBy: OrderBy[] = view.orderBy,
  // Overridable for callers that only want the X-Total-Count header (see
  // ViewStore.globalRankOfItem(), a count-only "rows before this one"
  // query) and don't care about `items` itself -- the server still requires
  // limit >= 1 (QueryBodyArgs.limit's Range(min=1, ...)), so this can't go
  // to 0, but 1 keeps that response payload minimal.
  limit: number = PAGE_SIZE,
  // Overridable for a caller that only reads a handful of a view's columns
  // (e.g. homeStats.ts's fetchRecentlyChanged, which never shows the rest of
  // what DataTable would) -- selecting only what's actually read saves the
  // server the JSON-extraction work for every other column, not just the
  // response bytes. Defaults to every column, i.e. what a ViewStore/DataTable
  // caller needs.
  columns: ColumnConfig[] = view.columns
): Promise<{ page: QueryPage; totalCount: number | null }> {
  const res = await apiFetch(`${API_BASE}${view.endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      select: ["handle", ...columns.map(toSelectEntry)],
      order_by: orderBy,
      limit,
      after: after ?? undefined,
      count: wantCount,
      where_expr: whereExpr || undefined,
    }),
  });
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }
  const totalCountHeader = res.headers.get("X-Total-Count");
  return {
    page: await res.json(),
    totalCount: totalCountHeader ? parseInt(totalCountHeader, 10) : null,
  };
}

/** A single-row equivalent of fetchPage(), used by applyLiveChange() to
 * refetch exactly the row a notification names. Gramps handles are
 * server-generated alphanumeric IDs with no quote/escape characters, so
 * splicing one into a where_expr string like this is safe. */
export async function fetchByHandle(view: ViewConfig, token: string, handle: string): Promise<QueryItem | null> {
  const { page } = await fetchPage(view, token, null, false, `handle == "${handle}"`);
  return page.items[0] ?? null;
}
