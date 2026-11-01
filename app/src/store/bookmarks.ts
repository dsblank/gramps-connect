// The tree's bookmarks -- Gramps' own, stored in the database's metadata,
// so they're shared by everyone working on the tree and are the same list
// Gramps desktop shows (gramps-web-api resources/bookmarks.py). One list
// per object type ("namespace"), in the order they were added; there are
// none for Tags. Reading needs nothing special; adding or removing needs
// EditObject, which is what the PUT/DELETE check server-side.
//
// Loaded once per session (and again whenever View > Bookmarks opens) into
// this module-level cache, so every record's star (BookmarkStar.tsx) can
// answer "is this bookmarked?" without a request of its own. There's no
// live-sync event for bookmarks, so another user's change shows up on the
// next load, not instantly.
import { API_BASE } from "../config";
import { getTreeId, hasPermissions } from "../auth/auth";
import { parseErrorMessage } from "./api";
import { apiFetch } from "./apiFetch";

/** VIEWS key -> gramps-web-api bookmark namespace, in the order the
 * Bookmarks page lists them. */
export const BOOKMARK_NAMESPACES: Record<string, string> = {
  person: "people",
  family: "families",
  event: "events",
  place: "places",
  source: "sources",
  citation: "citations",
  repository: "repositories",
  media: "media",
  note: "notes",
};

export const BOOKMARKABLE_TYPES = Object.keys(BOOKMARK_NAMESPACES);

export function isBookmarkable(type: string): boolean {
  return type in BOOKMARK_NAMESPACES;
}

/** Adding/removing a bookmark changes the tree for everyone. */
export function canEditBookmarks(): boolean {
  return hasPermissions("EditObject");
}

type Lists = Record<string, string[]>;

let lists: Lists | null = null;
/** The tree `lists` belongs to, so switching trees reloads rather than
 * showing the previous tree's stars. */
let listsTree: string | null = null;
let loading: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeBookmarks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBookmarksVersion(): number {
  return version;
}

function current(): Lists | null {
  return lists && listsTree === getTreeId() ? lists : null;
}

/** Fetches the lists unless they're already here (or `force`). Errors are
 * the caller's; the cache is left as it was. */
export function loadBookmarks(token: string, force = false): Promise<void> {
  if (!force && current()) return Promise.resolve();
  if (loading && !force) return loading;
  const tree = getTreeId();
  const request = (async () => {
    const res = await apiFetch(`${API_BASE}/api/bookmarks/`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(await parseErrorMessage(res));
    const body = (await res.json()) as Record<string, unknown>;
    const next: Lists = {};
    for (const [type, namespace] of Object.entries(BOOKMARK_NAMESPACES)) {
      const list = body[namespace];
      next[type] = Array.isArray(list) ? list.filter((h): h is string => typeof h === "string") : [];
    }
    lists = next;
    listsTree = tree;
    emit();
  })();
  loading = request;
  request.finally(() => {
    if (loading === request) loading = null;
  }).catch(() => {});
  return request;
}

/** Whether the lists have been loaded for this tree yet. */
export function bookmarksLoaded(): boolean {
  return current() !== null;
}

/** Handles bookmarked for `type`, in the order they were added. */
export function getBookmarks(type: string): string[] {
  return current()?.[type] ?? [];
}

export function isBookmarked(type: string, handle: string): boolean {
  return getBookmarks(type).includes(handle);
}

/** Adds or removes a bookmark. Shown at once and put back if the server
 * refuses, so the star never lies for long. */
export async function setBookmarked(token: string, type: string, handle: string, on: boolean): Promise<void> {
  const namespace = BOOKMARK_NAMESPACES[type];
  if (!namespace) throw new Error(`${type} can't be bookmarked`);
  const cached = current();
  const before = cached ? [...(cached[type] ?? [])] : null;
  if (cached) {
    const without = (cached[type] ?? []).filter((h) => h !== handle);
    cached[type] = on ? [...without, handle] : without;
    emit();
  }
  try {
    const res = await apiFetch(`${API_BASE}/api/bookmarks/${namespace}/${encodeURIComponent(handle)}`, {
      method: on ? "PUT" : "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    // Removing one someone else already removed is what was wanted.
    if (!res.ok && !(res.status === 404 && !on)) throw new Error(await parseErrorMessage(res));
  } catch (err) {
    const now = current();
    if (now && before) {
      now[type] = before;
      emit();
    }
    throw err;
  }
}
