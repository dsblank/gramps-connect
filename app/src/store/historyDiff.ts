// Pure field-level diff between two raw Gramps object dicts (a history
// change's old_data/new_data) -- no sql.js/DOM/network dependency, same
// "pure and testable on its own" shape as sql.ts. Used by HistoryButton's
// diff dialog: a person edit's old/new are both full Person dicts, and the
// user wants to see only what actually changed, not a re-render of the
// whole record.

export interface DiffRow {
  /** Path into the object, e.g. "primary_name.first_name" or
   * "event_ref_list[0].ref" -- bracketed array indices, matching Gramps
   * Object Query Language's own path syntax (gramps-web-api PR #962's
   * `select`/`where_expr` path expressions, e.g.
   * "birth.place.title as birthplace"), not a bare dotted index. */
  path: string;
  /** undefined when this path didn't exist before (an add). */
  before: unknown;
  /** undefined when this path no longer exists after (a delete). */
  after: unknown;
}

// Server/bookkeeping fields every object carries that never reflect a
// user-meaningful edit -- diffing them would just add noise (`change` is
// the very timestamp this diff is already shown under; `handle`/`_class`
// are identity, not content, and are never mutated in place).
const IGNORED_KEYS = new Set(["change", "handle", "_class"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when two values are the same for diffing purposes -- structural
 * equality via JSON, not reference equality (old_data/new_data are freshly
 * parsed JSON on every fetch, never the same object). Good enough here:
 * these are plain JSON trees (no Date/Map/undefined-valued keys), so a
 * JSON.stringify round trip is a correct and simple deep-equal. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Recursively walks two values at the same path, appending one DiffRow per
 * leaf that differs. A "leaf" is anything that isn't a plain object or
 * array -- a changed array is walked by index (no reordering/LCS
 * detection: good enough for the short ref-lists Gramps objects carry, and
 * far simpler than a real list diff). */
function walk(path: string, before: unknown, after: unknown, rows: DiffRow[]): void {
  if (sameValue(before, after)) return;

  const bothObjects = isPlainObject(before) && isPlainObject(after);
  const bothArrays = Array.isArray(before) && Array.isArray(after);

  if (bothObjects) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (IGNORED_KEYS.has(key)) continue;
      walk(path ? `${path}.${key}` : key, before[key], after[key], rows);
    }
    return;
  }

  if (bothArrays) {
    const length = Math.max(before.length, after.length);
    for (let i = 0; i < length; i++) {
      // `[i]`, not `.${i}` -- GOQL's own index syntax (see DiffRow.path's
      // doc comment), and it also reads unambiguously right after a plain
      // object key with no separating dot needed before the bracket.
      walk(`${path}[${i}]`, before[i], after[i], rows);
    }
    return;
  }

  rows.push({ path, before, after });
}

/** Diffs a history change's old_data/new_data into a flat list of changed
 * leaf paths. `before`/`after` null (an add or a delete, per
 * ObjectChangeSchema's trans_type 0/2) diffs against `{}` rather than being
 * special-cased, so an added/deleted record just shows every field as
 * fully added/removed. */
export function diffObjects(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): DiffRow[] {
  const rows: DiffRow[] = [];
  walk("", before ?? {}, after ?? {}, rows);
  return rows;
}

/** A short, scannable preview of which fields changed -- for a history
 * list row that wants to hint at *what* changed (e.g.
 * "primary_name.surname_list[0].surname") without the reader opening the
 * full diff dialog. Joins up to `maxPaths` paths with ", ", appending a
 * "+N more" count when there are more than that. `""` for no changes
 * (nothing to preview). */
export function summarizeDiffPaths(rows: DiffRow[], maxPaths = 2): string {
  if (rows.length === 0) return "";
  const shown = rows.slice(0, maxPaths).map((row) => row.path);
  const extra = rows.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} +${extra} more` : shown.join(", ");
}
