// Gramps name formats (Edit > Preferences > Display > Name format), applied
// client-side: a port of gen/display/name.py's NameDisplay.format_str_raw,
// which formats the same JSON Name struct the server sends us. Every name
// the app shows goes through formatDisplayName() so the tree's name format
// (displaySettings.ts) applies everywhere -- list cells, pickers, summaries
// -- and changing it needs no refetch, the same as dates and places
// (placeIndex.ts). A name's own "Display as" (display_as) overrides the
// tree's format for that name, as desktop's NameDisplay.display_name does.
// Server-formatted names (a profile's name_display) are asked for in the
// tree's format: nameFormatParam() -- the server ignores display_as then.
import { BUILTIN_NAME_FORMATS, DEFAULT_NAME_FORMAT, getDisplaySettings, getLoadedCustomNameFormats } from "./displaySettings";

interface RawSurname {
  surname?: string;
  prefix?: string;
  connector?: string;
  primary?: boolean;
  origintype?: { value?: number } | number;
}

/** The JSON Name struct (Person.primary_name, alternate_names[]). Every
 * field optional: drafts and older data can leave any of them out. */
export interface RawName {
  first_name?: string;
  surname_list?: RawSurname[];
  suffix?: string;
  title?: string;
  call?: string;
  nick?: string;
  famnick?: string;
  /** Name.DEF/LNFN/... (0 = the tree's format), or a custom format's
   * negative number. */
  display_as?: number;
}

const ORIGIN_PATRONYMIC = 5;
const ORIGIN_MATRONYMIC = 6;

function isPatro(s: RawSurname): boolean {
  const origin = typeof s.origintype === "number" ? s.origintype : s.origintype?.value;
  return origin === ORIGIN_PATRONYMIC || origin === ORIGIN_MATRONYMIC;
}

/** Python's str.split() + " ".join(): collapse all whitespace runs. */
function squash(text: string): string {
  return text.split(/\s+/u).filter(Boolean).join(" ");
}

/** __format_raw_surname: prefix, surname, then the connector -- padded with
 * spaces unless it's a hyphen. */
function surnamePart(s: RawSurname): string {
  let result = s.prefix ?? "";
  if (result) result += " ";
  result += s.surname ?? "";
  const connector = s.connector ?? "";
  if (result && connector !== "-") result += ` ${connector} `;
  else result += connector;
  return result;
}

/** The primary surname, except that a lone pa/matronymic isn't treated as
 * one (desktop's preferences.patronimic-surname, off by default). */
function primaryOf(list: RawSurname[]): RawSurname | null {
  const primary = list.find((s) => s.primary);
  if (!primary) return null;
  if (list.length === 1 && isPatro(primary)) return null;
  return primary;
}

const patroOf = (list: RawSurname[]) => list.find(isPatro) ?? null;

type Field = (n: RawName, surnames: RawSurname[]) => string;

// NameDisplay._gen_raw_func's table, same codes in the same order.
const FIELDS: [code: string, field: Field][] = [
  ["t", (n) => n.title ?? ""],
  ["f", (n) => n.first_name ?? ""],
  ["l", (_, l) => l.map(surnamePart).join("").trim()],
  ["s", (n) => n.suffix ?? ""],
  ["c", (n) => n.call ?? ""],
  ["x", (n) => n.nick || n.call || (n.first_name ?? "").split(" ")[0]],
  ["i", (n) => (". " + (n.first_name ?? "")).split(/\s+/u).filter(Boolean).slice(1).map((w) => w[0] + ".").join("")],
  ["m", (_, l) => { const p = primaryOf(l); return p ? surnamePart(p).trim() : ""; }],
  ["0m", (_, l) => primaryOf(l)?.prefix ?? ""],
  ["1m", (_, l) => primaryOf(l)?.surname ?? ""],
  ["2m", (_, l) => primaryOf(l)?.connector ?? ""],
  ["y", (_, l) => { const p = patroOf(l); return p ? surnamePart(p).trim() : ""; }],
  ["0y", (_, l) => squash(patroOf(l)?.prefix ?? "")],
  ["1y", (_, l) => squash(patroOf(l)?.surname ?? "")],
  ["2y", (_, l) => squash(patroOf(l)?.connector ?? "")],
  ["o", (_, l) => l.filter((s) => !s.primary && !isPatro(s)).map(surnamePart).join("").trim()],
  ["r", (_, l) => l.filter((s) => !s.primary).map(surnamePart).join("").trim()],
  ["p", (_, l) => squash(l.map((s) => `${s.prefix ?? ""} `).join(""))],
  ["q", (_, l) => squash(l.map((s) => `${s.surname ?? ""} `).join(""))],
  ["n", (n) => n.nick ?? ""],
  ["g", (n) => n.famnick ?? ""],
];
const FIELD_BY_CODE = new Map(FIELDS);

// _make_fn's patterns: punctuation hugging a code ("Surname, %f", "(%n)",
// "_%c_", '"%n"') is dropped along with it when that part is empty. Tried
// in this order at each position, as Python's alternation does. \W is
// Python's Unicode-aware "not a word character".
const CODE = `%(?:${[...FIELDS.map(([c]) => c), ...FIELDS.map(([c]) => c.toUpperCase())].join("|")})`;
const NW = "[^\\p{L}\\p{N}_]*";
const PATTERN = new RegExp(
  [`%%`, `,${NW}"${CODE}"`, `,${NW}\\(${CODE}\\)`, `,${NW}${CODE}`, `"${CODE}"`, `_${CODE}_`, `\\(${CODE}\\)`, CODE].join("|"),
  "gu",
);

/** cleanup_name: collapse the gaps empty parts leave, and attach a lone
 * comma/semicolon/colon to the word before it ("a , b" -> "a, b"). */
function cleanup(text: string): string {
  const parts = text.split(/\s+/u).filter(Boolean);
  if (!parts.length) return "";
  let result = parts[0];
  for (const part of parts.slice(1)) {
    result += [",", ";", ":", "،", "؛"].includes(part) ? part : ` ${part}`;
  }
  return result;
}

/** `name` in Gramps name format `format` (%-codes, as gramps-web-api's
 * name_format takes them), exactly as Gramps desktop shows it -- including
 * its quirks, e.g. ", John" for a name with no surname. */
export function formatName(name: RawName | null | undefined, format: string): string {
  if (!name) return "";
  const surnames = name.surname_list ?? [];
  return cleanup(
    format.replace(PATTERN, (match) => {
      if (match === "%%") return "%";
      const at = match.indexOf("%");
      const digit = /\d/.test(match[at + 1]);
      const code = match.slice(at + 1, at + (digit ? 3 : 2));
      const before = match.slice(0, at);
      const after = match.slice(at + 1 + code.length);
      let value = FIELD_BY_CODE.get(code.toLowerCase())!(name, surnames);
      if (code !== code.toLowerCase()) value = value.toUpperCase();
      return value === "" ? "" : before + value + after;
    }),
  );
}

/** The tree's name format (displaySettings.ts), with "Default" resolved. */
export function displayNameFormat(): string {
  return getDisplaySettings().name.format || DEFAULT_NAME_FORMAT;
}

/** The format `name` is shown in: its own display_as when that names an
 * active built-in or (loaded, usable) custom format, else the tree's --
 * NameDisplay._is_format_valid's fallback to Default. */
export function nameFormatFor(name: RawName): string {
  const num = name.display_as ?? 0;
  if (num) {
    const builtin = BUILTIN_NAME_FORMATS.find((opt) => opt.number === num);
    if (builtin?.format) return builtin.format;
    const custom = getLoadedCustomNameFormats().find((opt) => opt.number === num);
    if (custom?.usable && custom.active) return custom.format;
  }
  return displayNameFormat();
}

/** A Name struct in its display format (nameFormatFor); "" for no name at
 * all. Accepts the JSON-serialized string a local-cache column stores, too. */
export function formatDisplayName(name: RawName | string | null | undefined): string {
  if (!name) return "";
  const parsed = typeof name === "string" ? (JSON.parse(name) as RawName) : name;
  return formatName(parsed, nameFormatFor(parsed));
}

/** gramps-web-api's `name_format` query arg, so names the server formats
 * (a profile's name_display) match the ones formatted here. */
export function nameFormatParam(): string {
  return `name_format=${encodeURIComponent(displayNameFormat())}`;
}

// Sort keys for a name format. Only the two indexed flat columns sort
// cheaply: every JSON path key, even a trailing tiebreak, costs a full scan
// per page (100k Postgres fixture: 0.16 s for surname+given_name, 0.86 s
// with primary_name.suffix appended; SQLite 0.09 s vs 0.32 s).
const SURNAME_CODES = new Set(["l", "m", "1m", "q"]);
const GIVEN_CODES = new Set(["f", "i", "x"]);
const PATH_CODES: Record<string, string> = {
  t: "primary_name.title",
  c: "primary_name.call",
  n: "primary_name.nick",
  g: "primary_name.famnick",
  s: "primary_name.suffix",
};

/** The People list's order_by keys for name format `format`: its name
 * parts in the order the format writes them, so "Given" sorts by given
 * name and "Surname, Given" by surname -- as Gramps desktop sorts by the
 * formatted name. Surname codes map to the indexed `surname` column, given
 * name codes (and initials, and %x's usual given-name fallback) to
 * `given_name`. A part with no column (nickname, title, ...) becomes a JSON
 * path key only when the format leads with it, ahead of both columns --
 * the one case where it decides the order rather than breaking rare ties.
 * Whichever column the format leaves out is appended as the tiebreak. */
export function nameSortKeys(format: string): string[] {
  const keys: string[] = [];
  const add = (key: string) => {
    if (!keys.includes(key)) keys.push(key);
  };
  for (const match of format.replace(/%%/g, "").matchAll(/%([0-2][mMyY]|[a-zA-Z])/g)) {
    const code = match[1].toLowerCase();
    if (SURNAME_CODES.has(code)) add("surname");
    else if (GIVEN_CODES.has(code)) add("given_name");
    else if (PATH_CODES[code] && !keys.includes("surname") && !keys.includes("given_name")) add(PATH_CODES[code]);
    if (keys.includes("surname") && keys.includes("given_name")) break;
  }
  add("surname");
  add("given_name");
  return keys;
}

/** nameSortKeys() for the tree's name format (displaySettings.ts). */
export function displayNameSortKeys(): string[] {
  return nameSortKeys(displayNameFormat());
}
