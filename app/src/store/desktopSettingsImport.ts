// "Import from Gramps desktop": reads a desktop gramps.ini (and optionally
// place_formats.xml) and turns the settings gramps-connect can honor into
// edits of the Display settings (displaySettings.ts). Pure -- the dialog
// (ImportDesktopSettingsDialog.tsx) does the file reading and shows the
// preview; nothing here touches the network.
//
// Only the keys that something in gramps-connect actually uses are
// imported: place-auto, place-format (+ place_formats.xml), date-format,
// name-format, and the ID templates (iprefix..nprefix, see grampsIds.ts).
// See DISPLAY_SETTINGS_PLAN.md, Phase 3.
import { DateFormat, formatDate, getLocale, isLocaleRegistered, parseDate, resolveLocaleCode } from "@gramps-connect/gramps-date";

const SAMPLE_DATE = parseDate("1854-03-12");
import {
  BUILTIN_NAME_FORMATS,
  chooseGrampsFormat,
  FULL_PLACE_FORMAT,
  type CustomNameFormat,
  isValidIdTemplate,
  type DisplaySettings,
  type IdType,
  type PlaceFormatDef,
} from "./displaySettings";

// -- gramps.ini --

export interface IniValue {
  raw: string;
  /** Written as `;;key=value`: Gramps comments out every setting still at
   * its default (configmanager.py's save()), so this is the default, not a
   * choice the user made. */
  isDefault: boolean;
}

/** `section.key` -> value, for an INI file as gramps' ConfigManager writes
 * it. Plain `;` comments and anything unparseable are ignored. */
export function parseGrampsIni(text: string): Map<string, IniValue> {
  const values = new Map<string, IniValue>();
  let section = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1].trim();
      continue;
    }
    const isDefault = line.startsWith(";;");
    const body = isDefault ? line.slice(2) : line;
    if (!isDefault && line.startsWith(";")) continue;
    const eq = body.indexOf("=");
    if (!section || eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    // ";; Gramps key file" / ";; Automatically created at ..." headers have
    // no key=value shape and fall out above; a commented-out default does.
    if (!/^[\w.-]+$/.test(key)) continue;
    values.set(`${section}.${key}`, { raw: body.slice(eq + 1).trim(), isDefault });
  }
  return values;
}

/** The subset of Python literals ConfigManager writes for these keys (it
 * writes repr(value), booleans as 0/1): ints, True/False, quoted strings.
 * Never evaluated. */
export function parsePyLiteral(raw: string): string | number | boolean | null {
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (raw === "True") return true;
  if (raw === "False") return false;
  const quoted = /^(['"])(.*)\1$/s.exec(raw);
  if (quoted) return quoted[2].replace(/\\(['"\\])/g, "$1");
  return null;
}

// -- place_formats.xml --

/** gen/display/place.py's load_formats(): `<place_formats><format name
 * levels language street reverse/>...`. Throws on a file that isn't one. */
export function parsePlaceFormatsXml(text: string): PlaceFormatDef[] {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new Error("not valid XML");
  const top = doc.getElementsByTagName("place_formats")[0];
  if (!top) throw new Error("no <place_formats> element");
  return Array.from(top.getElementsByTagName("format")).map((el) => {
    const street = Number(el.getAttribute("street") ?? "0");
    return {
      name: el.getAttribute("name") ?? "",
      levels: el.getAttribute("levels") ?? ":",
      language: el.getAttribute("language") ?? "",
      street: street === 1 || street === 2 ? street : 0,
      reverse: el.getAttribute("reverse") === "True",
    };
  });
}

// -- Date formats per desktop language --

const D = DateFormat;
// Base DateDisplay order: ISO, Numerical, Month Day Year, MON Day Year,
// Day Month Year, Day MON Year -- shared by every language that doesn't
// override `formats`.
const BASE = [D.ISO, D.NUMERIC, D.LONG_MONTH_DAY_YEAR, D.SHORT_MONTH_DAY_YEAR, D.DAY_LONG_MONTH_YEAR, D.DAY_SHORT_MONTH_YEAR];

/** Desktop language -> its date-format list (gen/datehandler/_date_*.py,
 * each displayer's `formats`), mapped entry by entry to the nearest of the
 * six shared formats, or null when there is none -- the fallback for
 * languages gramps-date doesn't port yet; ported ones (isLocaleRegistered)
 * take desktop's number exactly (year-first
 * orders, Roman-numeral months). A numeric format maps to NUMERIC even
 * when desktop's is day-first, since NUMERIC is the only numeric one we
 * have -- the import preview shows the result, so that's visible. */
export const DESKTOP_DATE_FORMATS: Record<string, { label: string; formats: (DateFormat | null)[] }> = {
  en: { label: "English", formats: BASE },
  ar: { label: "Arabic", formats: BASE },
  bg: { label: "Bulgarian", formats: BASE },
  ca: { label: "Catalan", formats: BASE },
  cs: { label: "Czech", formats: BASE },
  da: { label: "Danish", formats: BASE },
  de: { label: "German", formats: [...BASE, D.NUMERIC] }, // + numeric with leading zeros
  el: { label: "Greek", formats: [D.ISO, D.NUMERIC, D.NUMERIC, D.DAY_LONG_MONTH_YEAR, D.DAY_SHORT_MONTH_YEAR] },
  es: { label: "Spanish", formats: BASE },
  fi: { label: "Finnish", formats: [D.ISO, D.NUMERIC, D.DAY_LONG_MONTH_YEAR] },
  fr: {
    label: "French",
    // ISO, system default (J/M/A), Jour Mois Année, Jour MOI Année, Jour.
    // Mois Année, Jour. MOI Année, Mois Jour Année, MOI Jour Année, JJ/MM/AAAA
    formats: [
      D.ISO, D.NUMERIC, D.DAY_LONG_MONTH_YEAR, D.DAY_SHORT_MONTH_YEAR, D.DAY_LONG_MONTH_YEAR,
      D.DAY_SHORT_MONTH_YEAR, D.LONG_MONTH_DAY_YEAR, D.SHORT_MONTH_DAY_YEAR, D.NUMERIC,
    ],
  },
  he: { label: "Hebrew", formats: BASE },
  hr: { label: "Croatian", formats: BASE },
  hu: { label: "Hungarian", formats: [D.ISO, null, null, null, null] }, // year-first
  is: { label: "Icelandic", formats: BASE },
  it: { label: "Italian", formats: BASE },
  ja: { label: "Japanese", formats: [D.ISO, null, null, null] }, // year-first
  ko: { label: "Korean", formats: BASE },
  lt: { label: "Lithuanian", formats: [D.ISO, null, null, D.SHORT_MONTH_DAY_YEAR] },
  nb: { label: "Norwegian", formats: BASE },
  nl: { label: "Dutch", formats: BASE },
  pl: { label: "Polish", formats: [D.ISO, D.NUMERIC, D.LONG_MONTH_DAY_YEAR, D.NUMERIC, D.DAY_LONG_MONTH_YEAR, null] },
  pt: { label: "Portuguese", formats: BASE },
  ru: { label: "Russian", formats: BASE },
  sk: { label: "Slovak", formats: BASE },
  sl: { label: "Slovenian", formats: BASE },
  sr: { label: "Serbian", formats: [D.ISO, D.NUMERIC, D.DAY_SHORT_MONTH_YEAR, D.DAY_LONG_MONTH_YEAR, null] },
  sv: { label: "Swedish", formats: [D.ISO, null, null, null] }, // year-first
  uk: { label: "Ukrainian", formats: BASE },
  zh: { label: "Chinese", formats: [D.ISO, D.NUMERIC] },
};

/** gramps-connect UI language ("de_AT", "zh_CN") -> a DESKTOP_DATE_FORMATS
 * key, defaulting to English. */
export function desktopLanguageFor(uiLang: string): string {
  // A language gramps-date has (exact or base) maps desktop's format
  // number exactly; otherwise the nearest-match table below.
  const exact = resolveLocaleCode(uiLang);
  if (exact) return exact;
  const base = uiLang.split(/[_-]/)[0].toLowerCase();
  if (base === "nn") return "nb";
  return base in DESKTOP_DATE_FORMATS ? base : "en";
}

// -- The import itself --

/** gramps.ini's [preferences] key for each type's ID template. */
const DESKTOP_ID_KEYS: Record<IdType, string> = {
  person: "iprefix",
  family: "fprefix",
  event: "eprefix",
  place: "pprefix",
  source: "sprefix",
  citation: "cprefix",
  repository: "rprefix",
  media: "oprefix",
  note: "nprefix",
};

export type ImportKey = "date" | "name" | "placeAuto" | "placeFormats" | "placeActive" | "ids";

export interface ImportItem {
  key: ImportKey;
  /** What desktop has, in words (format name, example, ...). */
  desktop: string;
  /** False when there's nothing gramps-connect can do with it -- shown,
   * but not selectable, with `reason`. */
  usable: boolean;
  reason?: string;
  /** Desktop's value is its own default (a `;;` line) -- shown, but not
   * ticked unless the user ticks it. */
  isDefault: boolean;
  apply: (settings: DisplaySettings) => DisplaySettings;
}

export interface ImportInput {
  ini: Map<string, IniValue>;
  /** Parsed place_formats.xml, when the user gave one. */
  placeFormats: PlaceFormatDef[] | null;
  /** DESKTOP_DATE_FORMATS key. */
  desktopLanguage: string;
  /** The tree's custom name formats (for a negative name-format). */
  customNameFormats: CustomNameFormat[];
  /** Human labels for the date formats, for `desktop` text. */
  dateFormatLabel: (format: DateFormat) => string;
}

function intValue(value: IniValue | undefined): number | null {
  const parsed = value ? parsePyLiteral(value.raw) : null;
  return typeof parsed === "number" ? parsed : typeof parsed === "boolean" ? Number(parsed) : null;
}

/** Everything in the files gramps-connect could import, in display order.
 * Settings not in the file at all (an old or hand-trimmed gramps.ini)
 * produce no item. */
export function buildImportItems(input: ImportInput): ImportItem[] {
  const { ini, placeFormats, desktopLanguage, customNameFormats } = input;
  const items: ImportItem[] = [];

  const dateValue = ini.get("preferences.date-format");
  const dateIndex = intValue(dateValue);
  const exactLocale = isLocaleRegistered(desktopLanguage) ? getLocale(desktopLanguage) : null;
  if (dateValue && dateIndex !== null && exactLocale && dateIndex >= 0 && dateIndex < exactLocale.formatNames.length) {
    // A language gramps-date ports exactly: desktop's number *is* that
    // language's format number -- including formats only it has, which
    // then apply to that language alone (chooseGrampsFormat).
    items.push({
      key: "date",
      desktop: `${exactLocale.formatNames[dateIndex]}  —  ${formatDate(SAMPLE_DATE, { grampsFormat: dateIndex, locale: exactLocale })}`,
      usable: true,
      isDefault: dateValue.isDefault,
      apply: (s) => chooseGrampsFormat(s, desktopLanguage, dateIndex),
    });
  } else if (dateValue && dateIndex !== null) {
    const table = DESKTOP_DATE_FORMATS[desktopLanguage] ?? DESKTOP_DATE_FORMATS.en;
    const mapped = table.formats[dateIndex] ?? null;
    items.push({
      key: "date",
      desktop: mapped !== null ? input.dateFormatLabel(mapped) : `#${dateIndex} (${table.label})`,
      usable: mapped !== null,
      reason: mapped === null ? "No matching date format in Gramps Connect" : undefined,
      isDefault: dateValue.isDefault,
      apply: (s) => (mapped === null ? s : { ...s, date: { format: mapped, byLanguage: s.date.byLanguage } }),
    });
  }

  const nameValue = ini.get("preferences.name-format");
  const nameNumber = intValue(nameValue);
  if (nameValue && nameNumber !== null) {
    // 0 is "Default", i.e. desktop's own preference -- here, the server's.
    const builtin = BUILTIN_NAME_FORMATS.find((opt) => opt.number === nameNumber);
    const custom = nameNumber < 0 ? customNameFormats.find((opt) => opt.number === nameNumber) : undefined;
    const format = builtin?.format ?? (custom?.usable ? custom.format : null);
    const reason = builtin
      ? undefined
      : custom
        ? custom.usable ? undefined : "This tree's custom format can't be used here"
        : nameNumber < 0
          ? "A custom format that isn't saved in this tree"
          : "Unknown name format";
    items.push({
      key: "name",
      desktop: builtin?.name ?? custom?.name ?? `#${nameNumber}`,
      usable: format !== null,
      reason,
      isDefault: nameValue.isDefault,
      apply: (s) => (format === null ? s : { ...s, name: { format } }),
    });
  }

  const autoValue = ini.get("preferences.place-auto");
  const auto = intValue(autoValue);
  if (autoValue && auto !== null) {
    items.push({
      key: "placeAuto",
      desktop: auto ? "On" : "Off",
      usable: true,
      isDefault: autoValue.isDefault,
      apply: (s) => ({ ...s, place: { ...s.place, auto: !!auto } }),
    });
  }

  // Desktop always has "Full" first (PlaceDisplay.__init__ / the format
  // editor's locked row 0); ours is pinned the same way, so the XML's first
  // entry is replaced by ours rather than imported.
  const formats = placeFormats ? [FULL_PLACE_FORMAT, ...placeFormats.slice(1)] : null;
  if (formats) {
    items.push({
      key: "placeFormats",
      desktop: formats.map((f) => f.name).join(", "),
      usable: true,
      isDefault: false,
      apply: (s) => ({
        ...s,
        // A different list means the old active index may point elsewhere:
        // fall back to Full unless placeActive (below) sets it too.
        place: { ...s.place, formats, active: s.place.active < formats.length ? s.place.active : 0 },
      }),
    });
  }

  const activeValue = ini.get("preferences.place-format");
  const active = intValue(activeValue);
  if (activeValue && active !== null) {
    const known = formats ? active < formats.length : active === 0;
    items.push({
      key: "placeActive",
      desktop: formats?.[active]?.name ?? (active === 0 ? FULL_PLACE_FORMAT.name : `#${active}`),
      usable: known && active >= 0,
      reason: known ? undefined : formats ? "Not in place_formats.xml" : "Needs place_formats.xml",
      isDefault: activeValue.isDefault,
      apply: (s) => (known && active < s.place.formats.length ? { ...s, place: { ...s.place, active } } : s),
    });
  }

  // ID templates: one row for all nine, since desktop sets them together
  // and they're rarely changed one at a time.
  const idValues = (Object.entries(DESKTOP_ID_KEYS) as [IdType, string][])
    .map(([type, key]) => {
      const value = ini.get(`preferences.${key}`);
      const parsed = value ? parsePyLiteral(value.raw) : null;
      return { type, value, template: typeof parsed === "string" ? parsed : null };
    })
    .filter((entry) => entry.value && entry.template !== null);
  if (idValues.length > 0) {
    const valid = idValues.filter((entry) => isValidIdTemplate(entry.template!));
    items.push({
      key: "ids",
      desktop: idValues.map((entry) => entry.template).join(", "),
      usable: valid.length > 0,
      reason: valid.length < idValues.length ? "Some ID formats can't be used here" : undefined,
      isDefault: idValues.every((entry) => entry.value!.isDefault),
      apply: (s) => ({
        ...s,
        ids: { ...s.ids, ...Object.fromEntries(valid.map((entry) => [entry.type, entry.template!])) },
      }),
    });
  }

  return items;
}

/** Applies the chosen items in order -- placeFormats before placeActive, as
 * buildImportItems() lists them, so the active index refers to the new
 * list. */
export function applyImport(settings: DisplaySettings, items: ImportItem[], chosen: Set<ImportKey>): DisplaySettings {
  const keys = withDependencies(items, chosen);
  return items.filter((item) => item.usable && keys.has(item.key)).reduce((s, item) => item.apply(s), settings);
}

/** placeActive is an index into desktop's place_formats.xml list, so when
 * that list is being imported at all, taking the index means taking the
 * list -- otherwise it would select whatever format sits at that position
 * here. */
export function withDependencies(items: ImportItem[], chosen: Set<ImportKey>): Set<ImportKey> {
  const keys = new Set(chosen);
  if (keys.has("placeActive") && items.some((item) => item.key === "placeFormats")) keys.add("placeFormats");
  return keys;
}
