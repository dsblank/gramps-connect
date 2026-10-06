// Per-tree display settings (date format, name format, place formats) --
// the gramps-connect side of Gramps desktop's Edit > Preferences > Display/
// Places tabs. gramps-web-api applies its *own process's* gramps.ini to
// everything it formats and exposes no endpoint to change that (config is a
// per-process global; see DISPLAY_SETTINGS_PLAN.md), so these settings are
// honored client-side instead and stored in the one place the server keeps
// arbitrary per-tree JSON: GET/PUT /api/trees/-/config (TreeConfigResource,
// a free-form blob in the user DB that nothing server-side reads back).
//
// Everything lives under one versioned `display` key, so other keys in the
// blob (ours later, or anyone else's) are left alone: PUT replaces the
// *whole* blob, hence saveDisplaySettings()'s read-modify-write. Reading
// needs only tree membership; writing needs EditTree (Owner and up), which
// is also exactly who can open Administration, where the editor lives.
//
// Cached per page load: switching trees reloads the page (ManageTreesDialog.
// tsx, UserManagementPanel.tsx), so there's no tree-switch invalidation to
// do. Plain-module + useSyncExternalStore, same shape as i18n.ts.
import { useEffect, useSyncExternalStore } from "react";
import { DateFormat } from "@gramps-connect/gramps-date";
import { API_BASE } from "../config";
import { getToken } from "../auth/auth";
import { parseErrorMessage } from "./api";

/** One entry of Gramps' place_formats.xml (gen/display/place.py's
 * PlaceFormat). `levels` is desktop's slice syntax ("1:", ":-1", "p" offsets
 * relative to the populated place); `street` is 0 none, 1 "Number Street",
 * 2 "Street Number" -- editplaceformat.glade's combo order. */
export interface PlaceFormatDef {
  name: string;
  levels: string;
  language: string;
  street: 0 | 1 | 2;
  reverse: boolean;
}

/** Object types that get a Gramps ID, as gramps.ini's iprefix..nprefix
 * cover them. */
export type IdType = "person" | "family" | "event" | "place" | "source" | "citation" | "repository" | "media" | "note";
export const ID_TYPES: IdType[] = ["person", "family", "event", "place", "source", "citation", "repository", "media", "note"];

export interface DisplaySettings {
  version: 1;
  date: { format: DateFormat };
  /** A Gramps name format *string* ("%f %l %s"), sent as gramps-web-api's
   * `name_format` request arg -- which takes a string, not a format number.
   * "" means "don't send it": the server's own preferences.name-format. */
  name: { format: string };
  place: {
    /** Desktop's preferences.place-auto: true formats places from their
     * hierarchy, false shows each place's stored `title`. */
    auto: boolean;
    /** Index into `formats`. */
    active: number;
    formats: PlaceFormatDef[];
  };
  /** Gramps ID templates for new records ("I%04d"), per type; "" lets the
   * server number it with Gramps' built-in templates (I%04d, F%04d, ...,
   * never its gramps.ini's -- see grampsIds.ts). Not display, despite
   * the key: the Preferences tab holds both (see grampsIds.ts). */
  ids: Record<IdType, string>;
}

/** Desktop's built-in format 0 -- PlaceDisplay.__init__'s fallback when
 * there's no place_formats.xml, and not editable in its format editor. */
export const FULL_PLACE_FORMAT: PlaceFormatDef = { name: "Full", levels: ":", language: "", street: 0, reverse: false };

/** Defaults reproduce what gramps-connect already shows with no settings at
 * all: DAY_SHORT_MONTH_YEAR is what views.ts/summary.ts/visualData.ts
 * hardcode today, and the server-default name format is what every request
 * already gets by not sending name_format. */
export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  version: 1,
  date: { format: DateFormat.DAY_SHORT_MONTH_YEAR },
  name: { format: "" },
  place: { auto: true, active: 0, formats: [FULL_PLACE_FORMAT] },
  ids: Object.fromEntries(ID_TYPES.map((type) => [type, ""])) as Record<IdType, string>,
};

/** Desktop's own defaults (gen/config.py's preferences.*prefix). */
export const GRAMPS_DEFAULT_ID_TEMPLATES: Record<IdType, string> = {
  person: "I%04d",
  family: "F%04d",
  event: "E%04d",
  place: "P%04d",
  source: "S%04d",
  citation: "C%04d",
  repository: "R%04d",
  media: "O%04d",
  note: "N%04d",
};

/** Desktop's ID templates take exactly one integer field, Python
 * %-style: "I%04d", "P%d", "ID-%05d-x". */
export function isValidIdTemplate(template: string): boolean {
  return /^[^%]*%0?\d*d[^%]*$/.test(template);
}

export interface NameFormatOption {
  /** Desktop's format number: 0 and up built-in, negative custom. */
  number: number;
  name: string;
  format: string;
}

/** gen/display/name.py's NameDisplay.STANDARD_FORMATS minus the deprecated
 * "Patronymic, Given" -- GET /api/name-formats/ returns only the tree's
 * *custom* formats (db.name_formats), never these. Numbers are Name.DEF/
 * LNFN/FN/FNLN/LNFNP, which is what a desktop gramps.ini's
 * preferences.name-format refers to. */
export const BUILTIN_NAME_FORMATS: NameFormatOption[] = [
  { number: 0, name: "Server default", format: "" },
  { number: 1, name: "Surname, Given Suffix", format: "%l, %f %s" },
  { number: 4, name: "Given", format: "%f" },
  { number: 2, name: "Given Surname Suffix", format: "%f %l %s" },
  { number: 5, name: "Main Surnames, Given Patronymic Suffix Prefix", format: "%1m %2m %o, %f %1y %s %0m" },
];

// Same character set as gramps-web-api's NAME_FORMAT_REGEXP (const.py) --
// anything else 422s every request that sends it.
const NAME_FORMAT_RE = /^(%[%tTfFlLcCxXiImMyYoOrRpPqQsSnNgG]|%[0-2][mMyY]|[ "',.:;\][(){}&@])*$/;

export function isValidNameFormat(format: string): boolean {
  return NAME_FORMAT_RE.test(format);
}

function normalizePlaceFormat(raw: unknown): PlaceFormatDef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || typeof r.levels !== "string") return null;
  const street = r.street === 1 || r.street === 2 ? r.street : 0;
  return {
    name: r.name,
    levels: r.levels,
    language: typeof r.language === "string" ? r.language : "",
    street,
    reverse: r.reverse === true,
  };
}

/** Tolerant reader for whatever's stored -- missing or malformed pieces fall
 * back to their defaults individually, so one bad field (hand-edited blob,
 * older/newer version) never takes the rest down with it. */
export function normalizeDisplaySettings(raw: unknown): DisplaySettings {
  const d = DEFAULT_DISPLAY_SETTINGS;
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, any>;

  const dateFormat = r.date?.format;
  const date = {
    format: typeof dateFormat === "number" && dateFormat in DateFormat ? (dateFormat as DateFormat) : d.date.format,
  };

  const nameFormat = r.name?.format;
  const name = { format: typeof nameFormat === "string" && isValidNameFormat(nameFormat) ? nameFormat : d.name.format };

  const custom = Array.isArray(r.place?.formats)
    ? (r.place.formats as unknown[]).map(normalizePlaceFormat).filter((f): f is PlaceFormatDef => !!f)
    : [];
  // Format 0 is always desktop's fixed "Full", whatever's stored there.
  const formats = [FULL_PLACE_FORMAT, ...custom.slice(1)];
  const active = r.place?.active;
  const place = {
    auto: typeof r.place?.auto === "boolean" ? r.place.auto : d.place.auto,
    active: Number.isInteger(active) && active >= 0 && active < formats.length ? active : 0,
    formats,
  };

  const ids = Object.fromEntries(
    ID_TYPES.map((type) => {
      const value = r.ids?.[type];
      return [type, typeof value === "string" && isValidIdTemplate(value) ? value : ""];
    }),
  ) as Record<IdType, string>;

  return { version: 1, date, name, place, ids };
}

// -- REST --

async function fetchTreeConfig(token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/api/trees/-/config`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const body = await res.json();
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}

async function putTreeConfig(token: string, config: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}/api/trees/-/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}

// NameDisplay._gen_cooked_func's code -> English keyword table
// (gen/display/name.py). Desktop's name-format editor stores custom formats
// with these words ("SURNAME, given (common)"), and only turns them into
// %-codes at display time -- but gramps-web-api's name_format arg is
// validated as %-codes only, so the conversion has to happen here.
const NAME_KEYWORDS: [code: string, keyword: string][] = [
  ["t", "title"], ["f", "given"], ["l", "surname"], ["s", "suffix"], ["c", "call"],
  ["x", "common"], ["i", "initials"], ["m", "primary"], ["0m", "primary[pre]"],
  ["1m", "primary[sur]"], ["2m", "primary[con]"], ["y", "patronymic"], ["0y", "patronymic[pre]"],
  ["1y", "patronymic[sur]"], ["2y", "patronymic[con]"], ["o", "notpatronymic"], ["r", "rest"],
  ["p", "prefix"], ["q", "rawsurnames"], ["n", "nickname"], ["g", "familynick"],
];

/** _make_fn's English keyword pass: longest keyword first (so
 * "notpatronymic" goes before "patronymic"), each in lower/Title/UPPER case,
 * UPPER mapping to the upper-case code. A format wrapped in double quotes is
 * literal %-codes in Gramps and passes through untouched. Translated
 * keywords (desktop in another language) aren't known here and are left
 * as-is -- isValidNameFormat() then rejects the result. */
export function nameKeywordsToCodes(format: string): string {
  if (format.length > 2 && format.startsWith('"') && format.endsWith('"')) return format.slice(1, -1);
  const sorted = [...NAME_KEYWORDS].sort(([, a], [, b]) => b.length - a.length || (a < b ? 1 : a > b ? -1 : 0));
  let result = format;
  for (const [code, keyword] of sorted) {
    const title = keyword.charAt(0).toUpperCase() + keyword.slice(1);
    result = result
      .split(keyword).join(`%${code}`)
      .split(title).join(`%${code}`)
      .split(keyword.toUpperCase()).join(`%${code.toUpperCase()}`);
  }
  return result;
}

export interface CustomNameFormat extends NameFormatOption {
  /** As stored in the tree, before nameKeywordsToCodes(). */
  original: string;
  /** False when the converted string still isn't something gramps-web-api
   * accepts (translated keywords, "!" verbatim-punctuation prefix, ...). */
  usable: boolean;
}

/** GET /api/name-formats/ -- the tree's custom name formats only (see
 * BUILTIN_NAME_FORMATS), with negative numbers. Usually empty. */
export async function fetchCustomNameFormats(): Promise<CustomNameFormat[]> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}/api/name-formats/`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const body = (await res.json()) as { number: number; name: string; format: string }[];
  return body.map(({ number, name, format }) => {
    const converted = nameKeywordsToCodes(format);
    return { number, name, format: converted, original: format, usable: isValidNameFormat(converted) };
  });
}

// -- Store --

let snapshot: DisplaySettings = DEFAULT_DISPLAY_SETTINGS;
let loadPromise: Promise<DisplaySettings> | null = null;
const listeners = new Set<() => void>();

function setSnapshot(next: DisplaySettings) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeDisplaySettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDisplaySettings(): DisplaySettings {
  return snapshot;
}

/** Loads once per page; later calls share the first one's promise. A failed
 * load (offline, older server without /trees/-/config) keeps the defaults
 * and is retried on the next call. */
export function loadDisplaySettings(): Promise<DisplaySettings> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const token = await getToken();
      const settings = normalizeDisplaySettings((await fetchTreeConfig(token)).display);
      setSnapshot(settings);
      return settings;
    })();
    loadPromise.catch(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}

/** Read-modify-write: re-GETs the blob right before the PUT so every other
 * key in it survives, then replaces only `display`. */
export async function saveDisplaySettings(next: DisplaySettings): Promise<void> {
  const token = await getToken();
  const config = await fetchTreeConfig(token);
  const normalized = normalizeDisplaySettings(next);
  await putTreeConfig(token, { ...config, display: normalized });
  loadPromise = Promise.resolve(normalized);
  setSnapshot(normalized);
}

/** Current settings, triggering the one-time load on first use. */
export function useDisplaySettings(): DisplaySettings {
  useEffect(() => {
    loadDisplaySettings().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribeDisplaySettings, getDisplaySettings);
}
