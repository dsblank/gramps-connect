// Locale plugin architecture for date display *and* parsing -- mirrors the
// shape of Gramps' own DateStrings (gen/datehandler/_datestrings.py) plus
// the handful of DateDisplay/DateParser subclass hooks locales actually
// override (see _datedisplay.py's DateDisplay and _dateparser.py's
// DateParser base classes), enough to plug in a new language's strings
// without touching display.ts/parse.ts. every language Gramps has
// (locales/available.generated.ts) ships here, loaded on demand
// (loadLocale); their strings are generated from a real Gramps by
// scripts/generate_gramps_locales.py and checked against Gramps' own output
// by __tests__/locales.test.ts and grampsTests.test.ts. A language whose
// displayer lays out dates its own way also needs its layouts in
// locales/index.ts.

import type { Calendar, DatePart, GrampsDate, Modifier, NewYear, NewYearValue, Quality } from "./types";
import type { GregorianLayout } from "./layouts";

/** What a language's own display() gets to work with. */
export interface DisplayHelpers {
  /** The language being displayed (its strings). */
  locale: DateLocale;
  /** One date part in the format being displayed (display_cal[cal]). */
  part: (datePart: DatePart, calendar: Calendar) => string;
  /** The " (Julian)" suffix (format_extras). */
  extras: (calendar: Calendar, newyear: NewYearValue) => string;
}

export type ParserPatternName =
  | "aboutBrackets" | "bce" | "calendar" | "calendarNewyear" | "calendarNewyearIso" | "iso" | "isoTimestamp"
  | "modifier" | "modifierAfter" | "numeric" | "newyear" | "newyearIso" | "quality" | "quarter" | "range"
  | "span" | "today" | "rfc";
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

/** The grammatical context a date is shown in: what precedes or governs
 * it ("before", "between", ...; "" for none). Gramps' context keys. */
export type InflectKey = "" | "from" | "to" | "between" | "and" | "before" | "after" | "about" | "estimated" | "calculated";

/** FORMATS_long/short_month_year: the form a context takes, and its
 * month-and-year template ("{month} {year}", Croatian "{month} {year}."). */
export interface MonthYearFormat {
  form: string | null;
  template: string;
}

export type MonthFormLists = "long" | "short" | "hebrew" | "french" | "islamic" | "persian";

export interface Inflection {
  /** Per month list, per month: form name -> word (null: a list without
   * forms). The first form is the plain name. */
  forms: Readonly<Record<MonthFormLists, readonly (Readonly<Record<string, string>> | null)[] | null>>;
  longMonthYear: Readonly<Record<InflectKey, MonthYearFormat>>;
  shortMonthYear: Readonly<Record<InflectKey, MonthYearFormat>>;
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

  /** _get_localized_year's addition to a bare year ("" for most;
   * Croatian "."). */
  yearSuffix: string;

  /** The base numeric format's result is left-trimmed (Norwegian's
   * dd_dformat01 override). */
  numericLstrip?: boolean;

  /** The language's own layouts apply to every calendar, not just
   * Gregorian (displayers overriding _display_calendar: Hungarian,
   * Swedish). */
  layoutsForAllCalendars?: boolean;

  /** A second long-month list (Lithuanian nominative), for layouts with
   * monthYearMonths "altLong". */
  altLongMonths?: MonthNames | null;

  /** Roman month numerals for "roman" layouts, index = month, when the
   * language writes its own (Hungarian "I.", "II."). */
  romanMonths?: MonthNames | null;

  /** Grammatical forms of month names (Gramps' Lexemes), for languages
   * whose translators gave them: cs, fi, hr, ru, sk, sl, uk. */
  inflection?: Inflection | null;

  /** Parser: the numeric pattern starts with a weekday (Icelandic
   * "%a %e.%b %Y" -- DateParser._ddmy). */
  numericWeekdayFirst: boolean;

  /** The language's base layouts (its translated dd_dformat01..05) --
   * what every non-Gregorian calendar uses. */
  baseLayouts: readonly GregorianLayout[];

  /** Gregorian layout for each of the language's numbered formats -- the
   * same numbering as desktop's Preferences list (`formatNames`). */
  gregorianLayouts: readonly GregorianLayout[];

  /** The language's own names for those formats, as desktop shows them. */
  formatNames: readonly string[];

  /** Which numbered format each of this package's six DateFormat values
   * means in this language (e.g. DAY_LONG_MONTH_YEAR is German format 4,
   * "Tag. Monat Jahr"). */
  formatIndex: Readonly<Record<number, number>>;

  /** Display templates per quality (none, estimated, calculated) -- some
   * languages word a date differently with a quality. */
  templates: readonly DateTemplates[];

  /** A language whose wording is grammar rather than templates (Hebrew's
   * "ב" prefix, added only without a day or with a quality) ports its
   * displayer's display() here; formatDate calls it instead of the
   * templates. */
  display?: (date: GrampsDate, helpers: DisplayHelpers) => string;

  /** Parser: every pattern Gramps' parser matches with, as JS regex
   * source (anchored) + case flag -- each language overrides some in its
   * init_strings. Group numbering is Gramps' own. */
  parserPatterns: Readonly<Record<ParserPatternName, { source: string; ignoreCase: boolean }>>;

  /** Parser: Gramps' month tables per calendar (word -> month number).
   * Gramps' parsers share one Gregorian table that every language adds to,
   * so it includes other languages' names too. The language's own month
   * names are added on top (parse.ts), fixing languages Gramps can't parse
   * at all. */
  monthTables: Readonly<Record<"gregorian" | "swedish" | "hebrew" | "french" | "islamic" | "persian", Readonly<Record<string, number>>>>;

  /** Parser: _rfc's English month abbreviations. */
  rfcMonths: Readonly<Record<string, number>>;

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

// English is registered here, unconditionally -- it's the default and the
// fallback, and registering it in this module (not a downstream barrel)
// guarantees it for every importer, this package's own tests included.
// Every other language loads on demand: loadLocale().
import { en } from "./locales/en";
import { availableLocaleCodes, buildLocale } from "./locales/index";
registerLocale(en);

/** Every language that can be loaded (and English), by code. */
export function availableLocales(): string[] {
  return availableLocaleCodes();
}

/** The best loadable language for a UI language code: the exact code
 * ("pt_BR"), else its base language ("de" for "de_CH"), else null. */
export function resolveLocaleCode(code: string): string | null {
  const available = new Set(availableLocaleCodes());
  if (available.has(code)) return code;
  const base = code.split(/[_-]/)[0];
  return available.has(base) ? base : null;
}

const loading = new Map<string, Promise<DateLocale | null>>();

/** Loads a language (once) and registers it, so getLocale(code) returns it
 * from then on. Resolves to null for an unknown code. */
export function loadLocale(code: string): Promise<DateLocale | null> {
  const existing = registry.get(code);
  if (existing) return Promise.resolve(existing);
  let promise = loading.get(code);
  if (!promise) {
    promise = buildLocale(code).then((locale) => {
      if (locale) registerLocale(locale);
      return locale;
    });
    loading.set(code, promise);
  }
  return promise;
}
