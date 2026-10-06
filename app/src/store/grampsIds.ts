// Gramps IDs for new records, from the tree's ID templates (Preferences ->
// New records; displaySettings.ts `ids`). Without a template, a new object
// goes to the server with no gramps_id and gramps-web-api numbers it with
// Gramps' built-in templates (I%04d, F%04d, ...): it never applies its
// gramps.ini's preferences.*prefix to a tree's database (desktop does that
// when opening a tree; only gramps-web-api's import dry-run and restore
// call set_prefixes), and no request can change them -- so when the tree
// has a template, gramps-connect picks the ID itself.
//
// File imports (POST /api/importers/...) never come through here: they run
// server-side and keep the file's IDs (Gramps XML) or format them with the
// built-in templates (GEDCOM @I12@ -> I0012), renumbering only clashes.
//
// The number: one past the highest already used with that template, per
// the type's local cache -- then each candidate is checked against the
// server (`gramps_id == "..."`), because a cache can be partial (still
// filling, filtered, or a filtered view such as Notes, which leaves out
// stories and messages). That check isn't atomic with the create, but it
// doesn't need to be: gramps-web-api's POST /api/objects/ refuses a
// duplicate Gramps ID (add_object(fail_if_exists=True)) and rolls back the
// whole batch, and createObjects() then retries once with fresh IDs.
//
// Differs from desktop in one way: desktop's counter starts at 0 each time
// the tree is opened and so fills gaps first; this always continues after
// the highest number, which is what "next ID" usually means to people.
import { fetchPage } from "./api";
import { getViewStore } from "./registry";
import { getDisplaySettings, type IdType } from "./displaySettings";

/** Object `_class` -> the ID type / view whose cache has its gramps_ids. */
const CLASS_TO_TYPE: Record<string, IdType> = {
  Person: "person",
  Family: "family",
  Event: "event",
  Place: "place",
  Source: "source",
  Citation: "citation",
  Repository: "repository",
  Media: "media",
  Note: "note",
};

/** Python's `template % n` for the one integer field a template has. */
export function formatGrampsId(template: string, n: number): string {
  return template.replace(/%(0?)(\d*)d/, (_m, zero: string, width: string) => {
    const digits = String(n);
    return width ? digits.padStart(Number(width), zero ? "0" : " ") : digits;
  });
}

/** The number in `id`, if `id` was made from `template`; else null. */
export function parseGrampsIdNumber(template: string, id: string): number | null {
  const match = /%(0?)(\d*)d/.exec(template);
  if (!match) return null;
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = escape(template.slice(0, match.index));
  const suffix = escape(template.slice(match.index + match[0].length));
  const found = new RegExp(`^${prefix} *(\\d+)${suffix}$`).exec(id);
  return found ? Number(found[1]) : null;
}

/** Highest number used with `template` among `ids`, or -1. */
export function highestNumber(template: string, ids: Iterable<unknown>): number {
  let highest = -1;
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const n = parseGrampsIdNumber(template, id);
    if (n !== null && n > highest) highest = n;
  }
  return highest;
}

async function existsOnServer(token: string, type: IdType, id: string): Promise<boolean> {
  const view = getViewStore(type).view;
  const literal = JSON.stringify(id);
  const { totalCount } = await fetchPage(view, token, null, true, `gramps_id == ${literal}`, view.orderBy, 1, []);
  return (totalCount ?? 0) > 0;
}

const MAX_SERVER_CHECKS = 50;

/** Copies of `objects` with a gramps_id filled in wherever the object has
 * none and its type has a template. Objects that already carry a
 * gramps_id, or whose type has no template, pass through unchanged (the
 * server numbers the latter with Gramps' built-in I%04d-style templates).
 * `assigned` reports what was filled in. */
export async function assignGrampsIds(
  token: string,
  objects: Record<string, unknown>[],
): Promise<{ objects: Record<string, unknown>[]; assigned: number }> {
  const templates = getDisplaySettings().ids;
  const next = new Map<IdType, number>();
  let assigned = 0;
  const result: Record<string, unknown>[] = [];

  for (const object of objects) {
    const type = CLASS_TO_TYPE[String(object._class)];
    const template = type ? templates[type] : "";
    if (!type || !template || (typeof object.gramps_id === "string" && object.gramps_id !== "")) {
      result.push(object);
      continue;
    }

    if (!next.has(type)) {
      const store = getViewStore(type);
      await store.ensureLoaded().catch(() => {});
      // Same batch's own IDs aren't in the cache yet; `next` covers those.
      next.set(type, highestNumber(template, store.readColumns(["gramps_id"]).map((row) => row[0])) + 1);
    }

    let n = next.get(type)!;
    let id = formatGrampsId(template, n);
    for (let checks = 0; checks < MAX_SERVER_CHECKS && (await existsOnServer(token, type, id)); checks++) {
      n++;
      id = formatGrampsId(template, n);
    }
    next.set(type, n + 1);
    result.push({ ...object, gramps_id: id });
    assigned++;
  }
  return { objects: result, assigned };
}
