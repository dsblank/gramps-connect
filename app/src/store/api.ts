// Talks to gramps-web-api's fast, SQL-pushed-down POST /api/<type>/query/
// endpoints (keyset-paginated, where_expr filtering, count support) --
// ported from the original Layer 2/3 spike's browser.ts (fetchPage; since
// removed, see git history).
import { API_BASE } from "../config";
import { toSelectEntry } from "./sql";
import type { ViewConfig } from "./views";

// Server-side max (see QueryBodyArgs.limit's Range(min=1, max=1000) in
// gramps-web-api's object_query.py) -- fewer round trips for a fixed
// dataset size than the default limit=50.
export const PAGE_SIZE = 1000;

export type QueryItem = Record<string, unknown> & { handle: string };

export interface QueryPage {
  items: QueryItem[];
  next_after: string | null;
}

export async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(`login failed: ${res.status} ${await res.text()}`);
  }
  const { access_token } = await res.json();
  return access_token as string;
}

async function parseErrorMessage(res: Response): Promise<string> {
  // QueryLangError etc. come back as {"error": {"code", "message"}} --
  // surface .message (e.g. "invalid syntax: ...") rather than the raw
  // envelope, falling back to the raw body if it's not that shape.
  const body = await res.text();
  try {
    return JSON.parse(body)?.error?.message ?? body;
  } catch {
    return body;
  }
}

export async function fetchPage(
  view: ViewConfig,
  token: string,
  after: string | null,
  wantCount: boolean,
  whereExpr: string | null
): Promise<{ page: QueryPage; totalCount: number | null }> {
  const res = await fetch(`${API_BASE}${view.endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      select: ["handle", ...view.columns.map(toSelectEntry)],
      order_by: view.orderBy,
      limit: PAGE_SIZE,
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
