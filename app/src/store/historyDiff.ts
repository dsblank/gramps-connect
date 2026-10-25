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

// Built-in names for the Gramps types that turn up inside list items (an
// added web link, event reference, attribute, ...): stored values carry
// only the number, and `string` only for a custom type. Unlisted classes
// and values fall back to the number, never a guess.
const TYPE_NAMES: Record<string, Record<number, string>> = {
  UrlType: { 0: "Custom", 1: "E-mail", 2: "Web Home", 3: "Web Search", 4: "FTP" },
  EventRoleType: {
    0: "Custom", 1: "Primary", 2: "Clergy", 3: "Celebrant", 4: "Aide", 5: "Bride", 6: "Groom", 7: "Witness",
    8: "Family", 9: "Informant",
  },
  NameType: { 0: "Custom", 1: "Also Known As", 2: "Birth Name", 3: "Married Name" },
  NameOriginType: {
    0: "Custom", 1: "", 2: "Inherited", 3: "Given", 4: "Taken", 5: "Patronymic", 6: "Matronymic", 7: "Feudal",
    8: "Pseudonym", 9: "Patrilineal", 10: "Matrilineal", 11: "Occupation", 12: "Location",
  },
  ChildRefType: {
    0: "None", 1: "Birth", 2: "Adopted", 3: "Stepchild", 4: "Sponsored", 5: "Foster", 6: "Unknown", 7: "Custom",
  },
  AttributeType: {
    0: "Custom", 1: "Caste", 2: "Description", 3: "Identification Number", 4: "National Origin",
    5: "Number of Children", 6: "Social Security Number", 7: "Nickname", 8: "Cause", 9: "Agency", 10: "Age",
    11: "Father's Age", 12: "Mother's Age", 13: "Witness", 14: "Time",
  },
};

export interface DiffValueOptions {
  /** Shows a stored Gramps Date as text; "" for an empty one. */
  formatDate: (date: Record<string, unknown>) => string;
  /** Translates a fixed label ("Unknown", "Web Home", "(none)", ...). */
  translate: (label: string) => string;
}

/** A Gramps type ({_class: "UrlType", value, string}) as its name: a
 * custom type's own `string`, else the built-in name for its value. "" for
 * Unknown (-1), which says nothing worth showing inside a larger value. */
function typeName(value: Record<string, unknown>, opts: DiffValueOptions): string {
  if (typeof value.string === "string" && value.string) return value.string;
  const num = value.value;
  if (typeof num !== "number" || num === -1) return "";
  const name = TYPE_NAMES[value._class as string]?.[num];
  return name === undefined ? String(num) : name && opts.translate(name);
}

function isGrampsType(value: Record<string, unknown>): boolean {
  return typeof value._class === "string" && value._class.endsWith("Type") && "value" in value;
}

/** Text for one value inside a larger one; "" when it holds nothing worth
 * showing (an empty list, string or date, an Unknown type, false). */
function summarize(value: unknown, opts: DiffValueOptions): string {
  if (value === null || value === undefined || value === false || value === "") return "";
  if (Array.isArray(value)) return value.map((item) => summarize(item, opts)).filter(Boolean).join("; ");
  if (!isPlainObject(value)) return String(value);
  if (value._class === "Date") return opts.formatDate(value);
  if (value._class === "StyledText") return typeof value.string === "string" ? value.string : "";
  if (isGrampsType(value)) return typeName(value, opts);
  const parts: string[] = [];
  for (const [key, field] of Object.entries(value)) {
    if (IGNORED_KEYS.has(key) || key === "private") continue;
    const text = summarize(field, opts);
    if (text) parts.push(`${key}: ${text}`);
  }
  if (value.private === true) parts.push(opts.translate("Private"));
  return parts.join(", ");
}

/** A diff row's before/after value as readable text. A whole object (a web
 * link, event reference or attribute added to or removed from a list, or
 * one replaced outright) reads as its non-empty fields, "path:
 * https://..., desc: Wikipedia, type: Web Home", with types, dates and
 * styled text shown by name rather than as the stored JSON. */
export function formatDiffValue(value: unknown, opts: DiffValueOptions): string {
  if (value === undefined) return "—";
  if (value === null) return opts.translate("(none)");
  if (typeof value !== "object") return String(value);
  return summarize(value, opts) || opts.translate("(none)");
}
