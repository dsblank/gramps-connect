// Locale plugin architecture for date display *and* parsing -- mirrors the
// shape of Gramps' own DateStrings (gen/datehandler/_datestrings.py) plus
// the handful of DateDisplay/DateParser subclass hooks locales actually
// override (see _datedisplay.py's DateDisplay and _dateparser.py's
// DateParser base classes), enough to plug in a new language's strings
// without touching display.ts/parse.ts. "en", "en_GB", "de", "fr" and "es" ship
// here (registered below); their strings are generated from a real Gramps
// by scripts/generate_gramps_locales.py and checked against Gramps' own
// output by __tests__/locales.test.ts. Add more the same way: run the
// script for the language, write locales/<code>.ts with its layouts, and
// register it below.

import type { Calendar, Modifier, NewYear, Quality } from "./types";
import type { GregorianLayout } from "./layouts";
export { BASE_LAYOUTS, type GregorianLayout } from "./layouts";

/** A month-name table, index 0 unused (Gramps' own 1-based month
 * convention) -- 13 entries for calendars with an intercalary/leap month
 * (Hebrew's AdarII, French's "Extra" day-name slot). */
export type MonthNames = readonly string[];

/** Display templates, extracted from Gramps' own output (see
 * scripts/generate_gramps_locales.py): placeholders {quality} {start}
 * {stop} {date} {calendar}. `modifiers` is indexed by Modifier, with that
 * modifier's word already in place ("{quality}vor {date}{calendar}");
 * RANGE/SPAN/TEXTONLY slots are unused. */
export interface DateTemplates {
  span: string;
  range: string;
  modifiers: readonly string[];
}

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

  // --- Parser-side (parse.ts): the free-text quick-entry counterparts to
  // the display-side strings above. Keys are matched case-insensitively,
  // so any casing works here; ports of _dateparser.py's own class-attribute
  // dicts (modifier_to_int, quality_to_int, etc.) on DateParser's base
  // (English) implementation -- a locale-specific DateParser subclass in
  // Gramps only ever *overrides* a subset of these, so a new locale here
  // only needs to supply what actually differs from "en" once more than
  // one locale ships; for now each locale supplies its own complete set.

  /** Modifier words appearing *before* the date ("about 1960"). Port of
   * `modifier_to_int`. */
  modifierWords: Readonly<Record<string, Modifier>>;

  /** Modifier words appearing *after* the date instead (a Finnish-style
   * locale's `modifier_after_to_int`) -- empty for English, which has none. */
  modifierWordsAfterDate: Readonly<Record<string, Modifier>>;

  /** Port of `quality_to_int` ("estimated", "calc.", ...). */
  qualityWords: Readonly<Record<string, Quality>>;

  /** Port of the `bce` list ("BC", "B.C.E.", ...), longest-first matching
   * handled by parse.ts, not by ordering here. */
  bceWords: readonly string[];

  /** Calendar-name words for the `"(Julian)"` / `"(Hebrew,Jan1)"` suffix
   * syntax. Port of `calendar_to_int` -- unlike `calendarNames` above
   * (display-only, Gregorian's slot is `""`), this includes "gregorian"
   * since a user can explicitly type `"(Gregorian)"`. */
  calendarWords: Readonly<Record<string, Calendar>>;

  /** New-year-code words ("Jan1"/"Mar1"/"Mar25"/"Sep1") for the newyear
   * suffix syntax and the New Year field. Port of `newyear_to_int`. */
  newyearWords: Readonly<Record<string, NewYear>>;

  /** Day/month/year ordering for ambiguous bare-numeric input like
   * `"3/4/1960"`, and for the two-groups-of-digits `text2`-style
   * "day month-name year" vs "year month-name day" choice. Port of
   * `DateParser.__init__`'s `dmy`/`ymd` booleans (derived there from the
   * locale's `dhformat`) -- "en" here is `"mdy"`, matching this package's
   * existing US-ordering simplification (see `numericFormat` above and
   * display.ts's own doc comment). */
  numericOrder: "dmy" | "mdy" | "ymd";

  /** Gregorian layout for each of the language's numbered formats -- the
   * same numbering as desktop's Preferences list (`formatNames`). */
  gregorianLayouts: readonly GregorianLayout[];

  /** The language's own names for those formats, as desktop shows them. */
  formatNames: readonly string[];

  /** Which numbered format each of this package's six DateFormat values
   * means in this language (e.g. DAY_LONG_MONTH_YEAR is German format 4,
   * "Tag. Monat Jahr"). */
  formatIndex: Readonly<Record<number, number>>;

  templates: DateTemplates;

  /** Parser: span/range patterns (JS regex source, anchored, with named
   * groups `start` and `stop`) -- ports of DateParser._span/_range. */
  spanPattern: string;
  rangePattern: string;

  /** Parser: every month word Gramps' parser accepts -> month number.
   * Gramps' parsers all share one table that every language adds to, so
   * this includes other languages' names too -- kept that way to accept
   * exactly what Gramps does. Added to the long/short month names. */
  monthWords: Readonly<Record<string, number>>;

  /** Parser: each calendar's two text-date patterns (month name first /
   * day first) -- Gramps' own, as JS regex source with `{months}` where the
   * month alternation goes. Languages differ in more than words here:
   * German and French allow any one character after the day ("12. März"),
   * forbid a dot after the month, and leave the end unanchored. */
  textPatterns: Readonly<Record<"gregorian" | "swedish" | "hebrew" | "french" | "persian" | "islamic", { text: string; text2: string }>>;
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
import { en_GB } from "./locales/en_GB";
import { de } from "./locales/de";
import { fr } from "./locales/fr";
import { es } from "./locales/es";
registerLocale(en);
registerLocale(en_GB);
registerLocale(de);
registerLocale(fr);
registerLocale(es);
