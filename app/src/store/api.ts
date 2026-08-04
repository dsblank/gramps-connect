// Talks to gramps-web-api's fast, SQL-pushed-down POST /api/<type>/query/
// endpoints (keyset-paginated, where_expr filtering, count support) --
// ported from the original Layer 2/3 spike's browser.ts (fetchPage; since
// removed, see git history).
import { API_BASE } from "../config";
import { toSelectEntry } from "./sql";
import type { OrderBy, ViewConfig } from "./views";

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
  const res = await fetch(`${API_BASE}/api/token/`, {
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
 * invalid or revoked -- the caller's only recourse at that point is a
 * fresh login. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/token/refresh/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${refreshToken}` },
  });
  if (!res.ok) {
    throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  }
  const { access_token } = await res.json();
  return access_token as string;
}

export async function parseErrorMessage(res: Response): Promise<string> {
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
  whereExpr: string | null,
  orderBy: OrderBy[] = view.orderBy,
  // Overridable for callers that only want the X-Total-Count header (see
  // ViewStore.findGlobalIndex(), a count-only "rows before this one" query)
  // and don't care about `items` itself -- the server still requires
  // limit >= 1 (QueryBodyArgs.limit's Range(min=1, ...)), so this can't go
  // to 0, but 1 keeps that response payload minimal.
  limit: number = PAGE_SIZE
): Promise<{ page: QueryPage; totalCount: number | null }> {
  const res = await fetch(`${API_BASE}${view.endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      select: ["handle", ...view.columns.map(toSelectEntry)],
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
