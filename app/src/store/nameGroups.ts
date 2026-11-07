// Gramps' surname grouping, for person search: a name's group is its own
// "Group as" (Name.group_as) if set, else the tree-wide surname mapping
// (the name_group table -- desktop's "Group all people with the same
// name?"), else its primary surname (gen/lib/name.py's get_group_name plus
// the db's get_name_group_mapping). Searching for "Smith" then also finds
// a Smyth grouped as Smith.
//
// Neither can go into the search's where_expr as a path: nothing indexes
// inside a record, so `like(primary_name.group_as, ...)` made every person
// search ~7x slower (100k Postgres fixture: 0.22 s -> 1.64 s; SQLite 0.15
// s -> 0.63 s). Instead both are looked up once -- the mappings (GET
// /api/name-groups/, a short list) and the few names that set Group as
// themselves (one query) -- and a search adds what matches as indexed
// `surname in [...]` / `handle in [...]` clauses.
//
// Kept current by live sync (treeChangeBus.ts): a changed person's own
// Group as is re-read by handle, a deleted one dropped. Mappings aren't in
// the transaction history, so only this tab's own writes (setNameGroup)
// refresh them; another user's new mapping shows up after a reload.
import { API_BASE } from "../config";
import { getToken } from "../auth/auth";
import { parseErrorMessage } from "./api";
import { apiFetch } from "./apiFetch";
import { subscribeTreeChange } from "./treeChangeBus";

/** More names than this with their own Group as (a full page -- the
 * server's limit is 1000): give up on the handle list and search the path
 * directly -- slow, but correct. Measured on the 100k fixtures, the
 * one-time lookup costs 2.4 s on Postgres and 0.35 s on SQLite (a full
 * scan, no count -- `count` would scan again); the `in [...]` clauses it
 * feeds cost nothing measurable per search. */
const MAX_GROUP_AS_HANDLES = 1000;

/** surname -> group, for surnames with a tree-wide mapping. */
let mappings = new Map<string, string>();
/** handle -> that person's primary name's own Group as (non-empty only). */
let groupAs = new Map<string, string>();
/** Too many names set their own Group as to list them (see above). */
let groupAsOverflow = false;
let loadPromise: Promise<void> | null = null;
let unsubscribe: (() => void) | null = null;

async function fetchJson(path: string, init?: RequestInit): Promise<Response> {
  const token = await getToken();
  const res = await apiFetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res;
}

async function fetchMappings(): Promise<Map<string, string>> {
  const body = (await (await fetchJson("/api/name-groups/")).json()) as { surname: string; group: string }[];
  // A surname mapped to itself (how setNameGroup() undoes a grouping --
  // the API can't delete one) is no grouping at all.
  return new Map(body.filter((m) => m.group && m.group !== m.surname).map((m) => [m.surname, m.group]));
}

async function queryGroupAs(whereExpr: string, limit: number): Promise<[string, string][]> {
  const res = await fetchJson("/api/people/query/", {
    method: "POST",
    body: JSON.stringify({ select: ["handle", "primary_name.group_as"], where_expr: whereExpr, limit }),
  });
  const body = (await res.json()) as { items: { handle: string; "primary_name.group_as"?: string | null }[] };
  return body.items.map((item) => [item.handle, item["primary_name.group_as"] ?? ""]);
}

/** Re-reads one person's Group as after a live change. */
async function refreshPerson(handle: string): Promise<void> {
  const rows = await queryGroupAs(`handle == ${JSON.stringify(handle)}`, 1);
  const value = rows[0]?.[1] ?? "";
  if (value) groupAs.set(handle, value);
  else groupAs.delete(handle);
}

/** Loads both lookups once per page (later calls share the first one's
 * promise; a failure is retried on the next call). Person search works
 * without them -- it just doesn't follow grouping until they arrive. */
export function loadNameGroups(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const [nextMappings, rows] = await Promise.all([
        fetchMappings(),
        queryGroupAs('primary_name.group_as != ""', MAX_GROUP_AS_HANDLES),
      ]);
      mappings = nextMappings;
      groupAs = new Map(rows.filter(([, value]) => value));
      groupAsOverflow = rows.length >= MAX_GROUP_AS_HANDLES;
      unsubscribe ??= subscribeTreeChange((notification) => {
        if (notification.table !== "person" || groupAsOverflow) return;
        if (notification.op === "DELETE") groupAs.delete(notification.handle);
        else refreshPerson(notification.handle).catch(() => {});
      });
    })();
    loadPromise.catch(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}

/** The tree-wide group for `surname`, or null if it has none. */
export function getNameGroup(surname: string): string | null {
  return mappings.get(surname) ?? null;
}

/** Groups everyone with `surname` as `group` tree-wide (desktop's "Group
 * all"), or, with `group` null, ungroups them -- written as a mapping of
 * the surname to itself, since gramps-web-api can only set a mapping, not
 * delete one. Needs EditNameGroup (Editor and up). Not a transaction: it
 * can't be undone from history, as in Gramps desktop. */
export async function setNameGroup(surname: string, group: string | null): Promise<void> {
  const target = group || surname;
  await fetchJson(`/api/name-groups/${encodeURIComponent(surname)}/${encodeURIComponent(target)}`, { method: "POST" });
  if (target === surname) mappings.delete(surname);
  else mappings.set(surname, target);
}

/** Extra where_expr alternatives for one search word: people whose group
 * (see above) contains `word`, case-insensitively like the search's own
 * `like()`. Empty when nothing matches or the lookups aren't loaded yet. */
export function groupSearchClauses(word: string): string[] {
  const needle = word.toLowerCase();
  const clauses: string[] = [];
  const surnames = [...mappings].filter(([, group]) => group.toLowerCase().includes(needle)).map(([surname]) => surname);
  if (surnames.length) clauses.push(`surname in ${JSON.stringify(surnames)}`);
  if (groupAsOverflow) {
    clauses.push(`like(primary_name.group_as, '%${word}%')`);
  } else {
    const handles = [...groupAs].filter(([, group]) => group.toLowerCase().includes(needle)).map(([handle]) => handle);
    if (handles.length) clauses.push(`handle in ${JSON.stringify(handles)}`);
  }
  return clauses;
}

/** Test-only: forget everything loaded. */
export function resetNameGroupsForTest(next?: { mappings?: [string, string][]; groupAs?: [string, string][]; overflow?: boolean }): void {
  mappings = new Map(next?.mappings ?? []);
  groupAs = new Map(next?.groupAs ?? []);
  groupAsOverflow = next?.overflow ?? false;
  loadPromise = null;
}
