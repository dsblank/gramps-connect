// Locale plugin architecture for date display -- mirrors the shape of
// Gramps' own DateStrings (gen/datehandler/_datestrings.py) plus the
// handful of DateDisplay subclass hooks locales actually override (see
// _datedisplay.py's DateDisplay base class), enough to plug in a new
// language's strings without touching display.ts. Only "en" ships in this
// package (registered below, unconditionally -- it's this package's
// always-available default, not an opt-in extra); add more the same way
// (a new locales/<code>.ts implementing DateLocale, registered via
// registerLocale()).

/** A month-name table, index 0 unused (Gramps' own 1-based month
 * convention) -- 13 entries for calendars with an intercalary/leap month
 * (Hebrew's AdarII, French's "Extra" day-name slot). */
export type MonthNames = readonly string[];

export interface DateLocale {
  /** BCP-47-ish tag, e.g. "en". Matched against gramps-web-api's own
   * `locale` request param where this package is driven by the same
   * value (see gramps-web-api's object-query endpoints' `locale` param,
   * used for collation -- not wired together yet, but the same string
   * should mean the same locale in both places). */
  code: string;

  longMonths: MonthNames;
  shortMonths: MonthNames;
  /** Gregorian/Julian/Swedish share these; other calendars have their
   * own month-name tables below. */

  hebrewMonths: MonthNames;
  frenchMonths: MonthNames;
  islamicMonths: MonthNames;
  persianMonths: MonthNames;

  longDays: MonthNames; // index 0 unused, 1=Sunday..7=Saturday (Gramps' own weekday numbering)
  shortDays: MonthNames;

  /** Indexed by Calendar -- display name for a non-Gregorian calendar
   * suffix, e.g. "(Julian)". Gregorian's own slot is "" (never shown). */
  calendarNames: MonthNames;

  /** Indexed by Modifier. A trailing space belongs on the *value* string
   * itself (e.g. "before "), matching _datestrings.py's own convention --
   * a handful of locales (Finnish) instead use a *leading* space to mark
   * "modifier goes after the date," which display.ts checks for. */
  modifierStrings: readonly [string, string, string, string, string, string, string, string, string];

  /** Indexed by Quality (only NONE/ESTIMATED/CALCULATED are used --
   * QUAL_INTERPRETED=4 is defined in date.py but never actually set
   * anywhere in Gramps, see that file's own comment). */
  qualityStrings: readonly [string, string, string];

  /** "%d/%d/%Y"-style strftime pattern for the locale's preferred
   * numeric format (display format 1) -- see DateDisplay.dhformat. Kept
   * simple relative to Gramps' own locale_tformat table (which has a
   * real entry per known locale); "en" here matches en_GB's slashed
   * D/M/Y, the same fallback DateDisplay itself uses when a locale isn't
   * in that table. */
  numericFormat: string;

  bceFormat: string; // e.g. "%s B.C.E." -- %s replaced with the formatted date
}

const registry = new Map<string, DateLocale>();

export function registerLocale(locale: DateLocale): void {
  registry.set(locale.code, locale);
}

/** Falls back to "en" for an unregistered code, the same way DateDisplay
 * itself falls back to en_GB's numeric format when a locale isn't in its
 * own table -- never throws for an unknown locale string. */
export function getLocale(code: string): DateLocale {
  return registry.get(code) ?? registry.get("en")!;
}

export function isLocaleRegistered(code: string): boolean {
  return registry.has(code);
}

// Registered here, not in index.ts: a side-effecting import is only
// guaranteed to run for code that actually imports index.ts. display.ts
// and entry.ts both reach getLocale() through this module directly, so
// registration has to live wherever the registry itself does, not in a
// downstream barrel file some callers (and this package's own test
// files) may never import.
import { en } from "./locales/en";
registerLocale(en);
