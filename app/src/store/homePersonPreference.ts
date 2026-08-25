// The Home page's "home person" shortcut -- a client-side-only preference,
// not Gramps' own db.default_person (Edit > Set Home Person in Gramps
// desktop, gramps-web-api's /api/metadata/'s read-only default_person
// field). Confirmed against gramps-web's own GrampsjsHomePerson.js: it
// calls appState.updateSettings({homePerson: ...}, true), which resolves
// to a plain localStorage write (src/api.js's updateSettings), never a
// server call -- there is no backend endpoint for this anywhere in
// gramps-web-api. Matches that same "per-browser, tree-scoped" shape here,
// same localStorage convention as columnWidths.ts, keyed by handle rather
// than gramps_id since every other Home-page item (RecentItem, MessageItem,
// StoryItem) is already handle-keyed.
import { getTreeId } from "../auth/auth";

const STORAGE_KEY = "gramps-connect_home_person";

type HandleByTree = Record<string, string>;

function readAll(): HandleByTree {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HandleByTree) : {};
  } catch {
    return {};
  }
}

/** getTreeId() is only non-null in multi-tree mode -- "unknown" (gramps-web's
 * own fallback key, for consistency) covers the single-tree case, where
 * every session already talks to the same one tree anyway. */
function treeKey(): string {
  return getTreeId() ?? "unknown";
}

export function getHomePersonHandle(): string | null {
  return readAll()[treeKey()] ?? null;
}

export function setHomePersonHandle(handle: string): void {
  const all = readAll();
  all[treeKey()] = handle;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
