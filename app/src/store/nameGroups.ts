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
// s -> 0.63 s). Instead both are looked up and a search adds what matches
// as indexed `surname in [...]` / `handle in [...]` clauses. The two
// lookups cost very differently, so they load separately:
//
// - The mappings (GET /api/name-groups/) are a short list: loaded at
//   startup (App.tsx), and refetched whenever the tab regains focus or a
//   name editor opens -- they aren't in the transaction history, so live
//   sync never hears about another user's new grouping.
// - The names with their own Group as take a full scan (100k fixtures: 2.4
//   s on Postgres, 0.35 s on SQLite), so they load on the first person
//   search, and stay current from live sync (treeChangeBus.ts): a changed
//   person's Group as is re-read by handle, a deleted one dropped.
//
// Either one landing or changing bumps a version (useNameGroupsVersion) so
// a search already showing re-runs with it -- otherwise a search typed
// before the scan finished would silently miss grouped names.
import { useSyncExternalStore } from "react";
import { API_BASE } from "../config";
import { getToken } from "../auth/auth";
import { parseErrorMessage } from "./api";
import { apiFetch } from "./apiFetch";
import { subscribeTreeChange } from "./treeChangeBus";

/** More names than this with their own Group as (a full page -- the
 * server's limit is 1000): give up on the handle list and search the path
 * directly -- slow, but correct. The `in [...]` clauses the list feeds
 * cost nothing measurable per search. */
const MAX_GROUP_AS_HANDLES = 1000;

/** At most one focus-driven mappings refetch per this long. */
const FOCUS_REFRESH_MS = 30_000;

/** surname -> group, for surnames with a tree-wide mapping. */
let mappings = new Map<string, string>();
/** handle -> that person's primary name's own Group as (non-empty only). */
let groupAs = new Map<string, string>();
/** Too many names set their own Group as to list them (see above). */
let groupAsOverflow = false;
let mappingsPromise: Promise<void> | null = null;
let mappingsLoadedAt = 0;
let groupAsPromise: Promise<void> | null = null;
let unsubscribeLive: (() => void) | null = null;

let version = 0;
const listeners = new Set<() => void>();

function bump() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes whenever the lookups load or change -- for a search that should
 * re-run with them (FilterBar.tsx, RecordPicker.tsx). */
export function useNameGroupsVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

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

function sameMap(a: Map<string, string>, b: Map<string, string>): boolean {
  return a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);
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
  if ((groupAs.get(handle) ?? "") === value) return;
  if (value) groupAs.set(handle, value);
  else groupAs.delete(handle);
  bump();
}

/** The tree-wide mappings: fetched once, or again with `force` (a name
 * editor opening, the tab regaining focus). Concurrent calls share one
 * request; a failure keeps what was there and is retried next time. */
export function loadNameGroupMappings(force = false): Promise<void> {
  if (!mappingsPromise || force) {
    const promise = (async () => {
      const next = await fetchMappings();
      mappingsLoadedAt = Date.now();
      if (sameMap(next, mappings)) return;
      mappings = next;
      bump();
    })();
    mappingsPromise = promise;
    promise.catch(() => {
      if (mappingsPromise === promise) mappingsPromise = null;
    });
  }
  return mappingsPromise;
}

/** The names with their own Group as: loaded once, on the first person
 * search (personSearch.ts), then kept current from live sync. */
export function loadGroupAsIndex(): Promise<void> {
  if (!groupAsPromise) {
    groupAsPromise = (async () => {
      const rows = await queryGroupAs('primary_name.group_as != ""', MAX_GROUP_AS_HANDLES);
      groupAs = new Map(rows.filter(([, value]) => value));
      groupAsOverflow = rows.length >= MAX_GROUP_AS_HANDLES;
      unsubscribeLive ??= subscribeTreeChange((notification) => {
        if (notification.table !== "person" || groupAsOverflow) return;
        if (notification.op === "DELETE") {
          if (groupAs.delete(notification.handle)) bump();
        } else {
          refreshPerson(notification.handle).catch(() => {});
        }
      });
      bump();
    })();
    groupAsPromise.catch(() => {
      groupAsPromise = null;
    });
  }
  return groupAsPromise;
}

/** Refetches the mappings when the tab comes back into focus (at most
 * every FOCUS_REFRESH_MS) -- another user's grouping can't reach us any
 * other way. Returns a cleanup function; mounted once by App.tsx. */
export function watchNameGroupMappings(): () => void {
  function onVisible() {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - mappingsLoadedAt < FOCUS_REFRESH_MS) return;
    loadNameGroupMappings(true).catch(() => {});
  }
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
  };
}

/** The tree-wide group for `surname`, or null if it has none. */
export function getNameGroup(surname: string): string | null {
  return mappings.get(surname) ?? null;
}

/** Groups everyone with `surname` as `group` tree-wide (desktop's "Group
 * all"), or, with `group` null, ungroups them -- written as a mapping of
 * the surname to itself, since gramps-web-api can only set a mapping, not
 * delete one. Needs EditNameGroup (Editor and up). Not a transaction: it
 * can't be undone from history, which is why draftStack.ts only calls it
 * once the person's own save has succeeded. */
export async function setNameGroup(surname: string, group: string | null): Promise<void> {
  const target = group || surname;
  await fetchJson(`/api/name-groups/${encodeURIComponent(surname)}/${encodeURIComponent(target)}`, { method: "POST" });
  if (target === surname) mappings.delete(surname);
  else mappings.set(surname, target);
  bump();
}

/** Extra where_expr alternatives for one search word: people whose group
 * (see above) contains `word`, case-insensitively like the search's own
 * `like()`. Empty when nothing matches or the lookups haven't loaded yet --
 * useNameGroupsVersion() changes when they do. */
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

/** Test-only: replace what's loaded, and mark both lookups as loaded so
 * nothing tries to fetch. */
export function resetNameGroupsForTest(next?: { mappings?: [string, string][]; groupAs?: [string, string][]; overflow?: boolean }): void {
  mappings = new Map(next?.mappings ?? []);
  groupAs = new Map(next?.groupAs ?? []);
  groupAsOverflow = next?.overflow ?? false;
  mappingsPromise = Promise.resolve();
  groupAsPromise = Promise.resolve();
}
