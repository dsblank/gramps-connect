// Who each event is "of": the people holding it in the Primary role and the
// families holding it in the Family role -- what "Referenced by" adds to an
// event row ("Birth: 1926 · John Smith"). An event doesn't point at its
// participants (they point at it), so a record's own detail request can't
// supply these; this is one /query/ per side, for all the event rows at once.
// Names are formatted here, by the viewer's own name format, the same as
// every list.
import { API_BASE } from "../config";
import { PAGE_SIZE, parseErrorMessage, queryWithOrderBy } from "./api";
import { displayNameFormat, formatDisplayName } from "./nameDisplay";
import { toOrderByWire } from "./sql";
import { subscribeTreeChange } from "./treeChangeBus";

/** EventRoleType values (gramps/gen/lib/eventroletype.py). */
const ROLE_PRIMARY = 1;
const ROLE_FAMILY = 8;

/** Handles per where_expr. */
const HANDLE_CHUNK = 200;
const CACHE_LIMIT = 50;

interface RawEventRef {
  ref?: string;
  role?: { value?: number } | number;
}

const cache = new Map<string, Record<string, string[]>>();

subscribeTreeChange((n) => {
  if (n.table === "person" || n.table === "family" || n.table === "event") cache.clear();
});

// The name format is part of the key: changing it in Preferences must
// relabel the rows.
function cacheKey(handles: string[]): string {
  return `${displayNameFormat()}|${[...handles].sort().join(",")}`;
}

export function getCachedEventPrincipals(handles: string[]): Record<string, string[]> | undefined {
  return cache.get(cacheKey(handles));
}

function roleValue(role: RawEventRef["role"]): number | undefined {
  return typeof role === "number" ? role : role?.value;
}

/** Every row of `endpoint` that refers to one of `chunk`'s events, paged to
 * the end. */
async function queryReferrers(
  token: string,
  endpoint: string,
  select: string[],
  chunk: string[],
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  // Handles are server-generated ids with no quote characters (see
  // api.ts's fetchByHandle()).
  const list = `[${chunk.map((h) => `'${h}'`).join(", ")}]`;
  const rows: Record<string, unknown>[] = [];
  let after: string | null = null;
  do {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const res = await queryWithOrderBy(`${API_BASE}${endpoint}`, token, (strings) => ({
      select: ["handle", "event_ref_list", ...select],
      where_expr: `any(r.ref in ${list} for r in event_ref_list)`,
      order_by: toOrderByWire([{ column: "handle", direction: "asc" }], strings),
      limit: PAGE_SIZE,
      after: after ?? undefined,
    }));
    if (!res.ok) throw new Error(await parseErrorMessage(res));
    const page: { items: Record<string, unknown>[]; next_after: string | null } = await res.json();
    rows.push(...page.items);
    after = page.next_after;
  } while (after !== null);
  return rows;
}

/** Event handle -> the names of its principals: each Primary person, then
 * each Family-role family as "Father & Mother" (each partner's own name,
 * as summary.ts labels a family). Events with none are left out. */
export async function fetchEventPrincipals(
  token: string,
  eventHandles: string[],
  signal?: AbortSignal,
): Promise<Record<string, string[]>> {
  const key = cacheKey(eventHandles);
  const hit = cache.get(key);
  if (hit) return hit;
  const wanted = new Set(eventHandles);
  const result: Record<string, string[]> = {};
  const add = (event: string, name: string) => {
    if (!name) return;
    const names = (result[event] ??= []);
    if (!names.includes(name)) names.push(name);
  };
  const chunks: string[][] = [];
  for (let i = 0; i < eventHandles.length; i += HANDLE_CHUNK) chunks.push(eventHandles.slice(i, i + HANDLE_CHUNK));
  const [personRows, familyRows] = await Promise.all([
    Promise.all(chunks.map((c) => queryReferrers(token, "/api/people/query/", ["primary_name"], c, signal))),
    Promise.all(
      chunks.map((c) =>
        queryReferrers(token, "/api/families/query/", ["father.primary_name as father_name", "mother.primary_name as mother_name"], c, signal),
      ),
    ),
  ]);
  const eventsWith = (row: Record<string, unknown>, role: number) =>
    ((row.event_ref_list as RawEventRef[] | null) ?? [])
      .filter((r) => r.ref && wanted.has(r.ref) && roleValue(r.role) === role)
      .map((r) => r.ref as string);
  for (const row of personRows.flat()) {
    const name = formatDisplayName(row.primary_name as Parameters<typeof formatDisplayName>[0]);
    for (const event of eventsWith(row, ROLE_PRIMARY)) add(event, name);
  }
  for (const row of familyRows.flat()) {
    const names = [row.father_name, row.mother_name]
      .map((n) => (n ? formatDisplayName(n as Parameters<typeof formatDisplayName>[0]) : ""))
      .filter(Boolean);
    for (const event of eventsWith(row, ROLE_FAMILY)) add(event, names.join(" & "));
  }
  cache.delete(key);
  cache.set(key, result);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return result;
}
