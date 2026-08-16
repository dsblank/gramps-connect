// Free-text date parsing: convert a typed string like
// "about Jan 1, 1983 (Hebrew,Jan1)" into a structured GrampsDate, the same
// job Gramps desktop's quick date-entry field
// (gui/widgets/monitoredwidgets.py's MonitoredDate) does via
// DateParser.parse() -- the *primary*, everyday way dates get entered
// there (the explicit modifier/quality/calendar/year/month/day fields
// entry.ts's makeDate builds on are Gramps desktop's secondary "expanded
// editor," for whatever this parser can't handle or the user prefers not
// to type).
//
// Translated from gramps/gen/datehandler/_dateparser.py's base DateParser
// class -- English locale, but not hardcoded to it: every word table and
// the day/month/year ordering come from the resolved DateLocale (see
// locale.ts's parser-side fields), the same way display.ts already takes
// a `locale` option instead of hardcoding strings. A future non-English
// locale is "add a locales/xx.ts and register it," not "edit this file."
//
// Deliberately not ported (see the plan this implements):
//   - RFC-2822 email-header dates ("Sun, 06 Nov 1994 08:49:37 GMT") -- not
//     a plausible manual genealogy-entry format
//   - MSSQL-style separator-less timestamps ("19831225") -- low value
//   - Any locale beyond "en" (locale.ts's DateLocale carries what a future
//     one would need; none is populated yet)
//   - Non-Jan-1 "today" calendar conversion: "$T"/"today" always returns
//     the current Gregorian date regardless of the calendar in context --
//     converting "today" into Hebrew/Persian/Islamic/French/Swedish terms
//     is a vanishingly rare thing to type and not worth the extra surface
//
// Original:
//   Gramps - a GTK+/GNOME based genealogy program
//   Copyright (C) 2004-2006  Donald N. Allingham
//   Copyright (C) 2017       Paul Franklin
//   Copyright (c) 2020       Steve Youngs
//   Licensed under the GNU General Public License, version 2 or later.
//   https://github.com/gramps-project/gramps/blob/master/gramps/gen/datehandler/_dateparser.py

import { Calendar, Modifier, Quality, type DatePart, type GrampsDate, type NewYearValue } from "./types";
import { makeDate } from "./entry";
import { isValidCalendarDate } from "./calendar";
import { type DateLocale, type MonthNames, getLocale } from "./locale";

export interface ParseDateOptions {
  /** Locale code (see locale.ts's registry) or a DateLocale object
   * directly. Defaults to "en". */
  locale?: string | DateLocale;
}

function resolveLocale(locale: string | DateLocale | undefined): DateLocale {
  if (locale === undefined) return getLocale("en");
  if (typeof locale === "string") return getLocale(locale);
  return locale;
}

/** `_get_int`: 0 for a missing capture group, matching Python's own
 * None -> 0 convention (used throughout _dateparser.py). */
function getInt(val: string | undefined): number {
  if (val === undefined) return 0;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? 0 : n;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Port of `re_longest_first`: an alternation group that tries longer
 * words first, so e.g. "about" doesn't get shadowed by a shorter word
 * that happens to be a prefix of it. */
function reLongestFirst(words: readonly string[]): string {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  return `(${sorted.map(escapeRegExp).join("|")})`;
}

/** Port of `_build_prefix_table`/`_generate_variants`: map every literal
 * month name across the given (index-aligned) source arrays to its
 * 1-based index, then add every unambiguous prefix of each name too (so
 * "Jan" resolves the same as "January"), longest name first so a shorter
 * name's own prefixes never steal a longer name's already-claimed ones. */
function buildMonthTable(...sources: readonly MonthNames[]): Map<string, number> {
  const table = new Map<string, number>();
  const length = sources[0]?.length ?? 0;
  for (let i = 1; i < length; i++) {
    for (const src of sources) {
      const name = src[i];
      if (name) table.set(name.toLowerCase(), i);
    }
  }
  const fullNames = [...table.keys()].sort((a, b) => b.length - a.length);
  for (const name of fullNames) {
    const index = table.get(name)!;
    for (let prefixLen = name.length - 1; prefixLen >= 1; prefixLen--) {
      const prefix = name.slice(0, prefixLen);
      if (prefix.trim() !== prefix) continue;
      if (table.has(prefix)) break;
      table.set(prefix, index);
    }
  }
  return table;
}

type MonthStyle = "greg" | "other";

interface CalendarMonthTables {
  toIndex: Map<string, number>;
  textRe: RegExp;
  text2Re: RegExp;
}

/** Gregorian/Julian/Swedish: `Month[.]? [day][,] [year][/slash]`. Swedish
 * in real Gramps has a very slightly different regex shape (mandatory,
 * not optional, whitespace before the day); folded into the same style
 * here as a small, documented simplification -- "en" has no distinct
 * Swedish month names anyway (see locales/en.ts). */
function buildGregorianStyleTables(toIndex: Map<string, number>): CalendarMonthTables {
  const alt = reLongestFirst([...toIndex.keys()]);
  return {
    toIndex,
    textRe: new RegExp(`^${alt}\\.?(\\s+\\d+)?\\s*,?\\s+((\\d+)(/\\d+)?)?\\s*$`, "i"),
    text2Re: new RegExp(`^(\\d+)?\\s+?${alt}\\.?\\s*((\\d+)(/\\d+)?)?\\s*$`, "i"),
  };
}

/** Hebrew/French/Persian/Islamic: `Month day[,] [year][/slash]` -- no
 * trailing-dot abbreviation, mandatory space after the month name instead
 * of an optional leading space on the day. */
function buildOtherCalendarTables(toIndex: Map<string, number>): CalendarMonthTables {
  const alt = reLongestFirst([...toIndex.keys()]);
  return {
    toIndex,
    textRe: new RegExp(`^${alt}\\s+(\\d+)?\\s*,?\\s*((\\d+)(/\\d+)?)?\\s*$`, "i"),
    text2Re: new RegExp(`^(\\d+)?\\s+?${alt}\\s*((\\d+)(/\\d+)?)?\\s*$`, "i"),
  };
}

interface CompiledLocale {
  locale: DateLocale;
  months: Record<Calendar, CalendarMonthTables>;
  calRe: RegExp;
  calNyRe: RegExp;
  calNyIsoRe: RegExp;
  nyRe: RegExp;
  nyIsoRe: RegExp;
  qualRe: RegExp;
  spanRe: RegExp;
  rangeRe: RegExp;
  quarterRe: RegExp;
  modifierRe: RegExp;
  modifierAfterRe: RegExp | null;
  bracketAboutRe: RegExp;
  numericRe: RegExp;
  isoRe: RegExp;
  todayRe: RegExp;
  bceRe: RegExp;
}

const compiledCache = new Map<string, CompiledLocale>();

/** Port of `DateParser.__init_prefix_tables`'s once-per-language cache --
 * table/regex construction is memoized per locale code, so a UI text
 * field calling parseDate() on every blur doesn't rebuild them each time. */
function compileLocale(locale: DateLocale): CompiledLocale {
  const cached = compiledCache.get(locale.code);
  if (cached) return cached;

  const gregorianTable = buildMonthTable(locale.longMonths, locale.shortMonths);
  const hebrewTable = buildMonthTable(locale.hebrewMonths);
  const frenchTable = buildMonthTable(locale.frenchMonths);
  const islamicTable = buildMonthTable(locale.islamicMonths);
  const persianTable = buildMonthTable(locale.persianMonths);

  const months: Record<Calendar, CalendarMonthTables> = {
    [Calendar.GREGORIAN]: buildGregorianStyleTables(gregorianTable),
    [Calendar.JULIAN]: buildGregorianStyleTables(gregorianTable),
    [Calendar.SWEDISH]: buildGregorianStyleTables(gregorianTable),
    [Calendar.HEBREW]: buildOtherCalendarTables(hebrewTable),
    [Calendar.FRENCH]: buildOtherCalendarTables(frenchTable),
    [Calendar.ISLAMIC]: buildOtherCalendarTables(islamicTable),
    [Calendar.PERSIAN]: buildOtherCalendarTables(persianTable),
  };

  const calAlt = reLongestFirst(Object.keys(locale.calendarWords));
  const nyAlt = reLongestFirst(Object.keys(locale.newyearWords));
  const qualAlt = reLongestFirst(Object.keys(locale.qualityWords));
  const modAlt = reLongestFirst(Object.keys(locale.modifierWords));
  const modAfterWords = Object.keys(locale.modifierWordsAfterDate);
  const bceAlt = reLongestFirst(locale.bceWords);
  const todayAlt = reLongestFirst(["today", "$T"]);

  const compiled: CompiledLocale = {
    locale,
    months,
    bceRe: new RegExp(`^(.*)\\s+${bceAlt}( ?.*)`, "i"),
    calRe: new RegExp(`^(.*)\\s+\\(${calAlt}\\)( ?.*)`, "i"),
    calNyRe: new RegExp(`^(.*)\\s+\\(${calAlt},\\s*${nyAlt}\\)( ?.*)`, "i"),
    calNyIsoRe: new RegExp(`^(.*)\\s+\\(${calAlt},\\s*(\\d{1,2}-\\d{1,2})\\)( ?.*)`, "i"),
    nyRe: new RegExp(`^(.*)\\s+\\(${nyAlt}\\)( ?.*)`, "i"),
    nyIsoRe: /^(.*)\s+\((\d{1,2}-\d{1,2})\)( ?.*)/,
    qualRe: new RegExp(`^(.* ?)${qualAlt}\\s+(.+)`, "i"),
    spanRe: /^(from)\s+(.+)\s+to\s+(.+)/i,
    rangeRe: /^(bet|bet\.|between)\s+(.+)\s+and\s+(.+)/i,
    quarterRe: /^[qQ]([1-4])\s+(.+)/,
    modifierRe: new RegExp(`^${modAlt}\\s+(.*)`, "i"),
    modifierAfterRe: modAfterWords.length ? new RegExp(`^(.*)\\s+${reLongestFirst(modAfterWords)}`, "i") : null,
    bracketAboutRe: /^<(.*)>/i,
    numericRe: /^((\d+)[/.]\s*)?((\d+)[/.]\s*)?(\d+)\s*$/,
    isoRe: /^(\d+)(\/(\d+))?-(\d+)(-(\d+))?\s*$/,
    todayRe: new RegExp(`^\\s*${todayAlt}\\s*$`, "i"),
  };
  compiledCache.set(locale.code, compiled);
  return compiled;
}

/** Sentinel for "this text didn't match" -- distinct from a *genuinely*
 * empty DatePart only by convention (Python's own Date.EMPTY has the same
 * dual role; not a bug to fix here, just a faithful port). */
const NO_MATCH: DatePart = [0, 0, 0, false];

function isNoMatch(part: DatePart): boolean {
  return part[0] === 0 && part[1] === 0 && part[2] === 0 && !part[3];
}

/** Port of `_parse_calendar`: try `Month day, year` then `day Month year`
 * (or `year Month day` for a ymd-ordered locale), validating against
 * `isValidCalendarDate`. */
function parseCalendarMonthText(
  text: string,
  tables: CalendarMonthTables,
  calendar: Calendar,
  numericOrder: DateLocale["numericOrder"]
): DatePart | null {
  let m = tables.textRe.exec(text);
  if (m) {
    const monthWord = m[1];
    const month = tables.toIndex.get(monthWord.toLowerCase()) ?? 0;
    let day: number, year: number, slash: boolean;
    if (m[3] === undefined) {
      year = getInt(m[2]);
      day = 0;
      slash = false;
    } else {
      day = getInt(m[2]);
      if (m[5] !== undefined) {
        year = getInt(m[4]) + 1;
        slash = true;
      } else {
        year = getInt(m[4]);
        slash = false;
      }
    }
    if (slash && isValidCalendarDate(Calendar.JULIAN, year, month, day)) {
      // slash year: accept as-is, same as Python's early-out
    } else if (!isValidCalendarDate(calendar, year, month, day)) {
      return null;
    }
    return [day, month, year, slash];
  }

  m = tables.text2Re.exec(text);
  if (m) {
    let day: number, month: number, year: number | null, slash: boolean;
    if (numericOrder === "ymd") {
      // Faithful port of DateParser's own ymd branch -- not exercised by
      // "en" (numericOrder "mdy"), kept for a future ymd-ordered locale.
      month = m[4] !== undefined ? tables.toIndex.get(m[4].toLowerCase()) ?? 0 : 0;
      day = getInt(m[5]);
      if (m[1] === undefined) {
        year = null;
        slash = false;
      } else if (m[3] !== undefined) {
        year = getInt(m[2]) + 1;
        slash = true;
      } else {
        year = getInt(m[2]);
        slash = false;
      }
    } else {
      month = m[2] !== undefined ? tables.toIndex.get(m[2].toLowerCase()) ?? 0 : 0;
      day = getInt(m[1]);
      if (m[3] === undefined) {
        year = null;
        slash = false;
      } else if (m[5] !== undefined) {
        year = getInt(m[4]) + 1;
        slash = true;
      } else {
        year = getInt(m[4]);
        slash = false;
      }
    }
    if (year === null) return null;
    if (!isValidCalendarDate(calendar, year, month, day)) return null;
    return [day, month, year, slash];
  }

  return null;
}

/** Port of `_parse_subdate`: month-name text, then ISO `Y-M-D`, then bare
 * numeric, then "today"/"$T". */
function parseSubdate(text: string, tables: CompiledLocale, calendar: Calendar): DatePart | null {
  const monthResult = parseCalendarMonthText(text, tables.months[calendar], calendar, tables.locale.numericOrder);
  if (monthResult) return monthResult;

  let m = tables.isoRe.exec(text);
  if (m) {
    const year = getInt(m[1]);
    const month = getInt(m[4]);
    const day = getInt(m[6]);
    if (m[3] !== undefined && isValidCalendarDate(Calendar.JULIAN, year + 1, month, day)) {
      return [day, month, year + 1, true];
    }
    if (isValidCalendarDate(calendar, year, month, day)) return [day, month, year, false];
    return null;
  }

  m = tables.numericRe.exec(text);
  if (m) {
    if (m[1] === undefined && m[2] === undefined && m[3] === undefined && m[4] === undefined && m[5] === undefined) {
      return null;
    }
    let day: number, month: number, year: number;
    if (tables.locale.numericOrder === "ymd") {
      if (m[2] === undefined) {
        year = getInt(m[5]);
        month = 0;
        day = 0;
      } else if (m[4] === undefined) {
        year = getInt(m[2]);
        month = getInt(m[5]);
        day = 0;
      } else {
        year = getInt(m[2]);
        month = getInt(m[4]);
        day = getInt(m[5]);
      }
      if (month > 12) {
        const modyear = year % 100 === 99 ? (year + 1) % 1000 : year % 10 === 9 ? (year + 1) % 100 : (year + 1) % 10;
        if (month === modyear) return [0, 0, year + 1, true];
      }
    } else {
      year = getInt(m[5]);
      if (tables.locale.numericOrder === "dmy") {
        if (m[4] === undefined) {
          month = getInt(m[2]);
          day = 0;
        } else {
          month = getInt(m[4]);
          day = getInt(m[2]);
        }
      } else {
        month = getInt(m[2]);
        day = getInt(m[4]);
      }
      if (month > 12) {
        const modyear = month % 100 === 99 ? (month + 1) % 1000 : month % 10 === 9 ? (month + 1) % 100 : (month + 1) % 10;
        if (year === modyear) return [0, 0, month + 1, true];
      }
    }
    if (!isValidCalendarDate(calendar, year, month, day)) return null;
    return [day, month, year, false];
  }

  if (tables.todayRe.test(text)) {
    const now = new Date();
    return [now.getDate(), now.getMonth() + 1, now.getFullYear(), false];
  }

  return null;
}

// The next five functions all follow the same shape as their Python
// originals: a regex with a leading `(.*)` "everything before" group,
// then one or two "the matched word(s)" groups, then a trailing
// `( ?.*)` "everything after" group -- reconstruct the text by
// concatenating the *first* and *last* groups (dropping the matched
// word from the middle), same as Python's `match.group(1) + match.group(N)`.

function matchBce(text: string, tables: CompiledLocale): [string, boolean] {
  const m = tables.bceRe.exec(text);
  if (m) return [m[1] + m[3], true];
  return [text, false];
}

function matchCalendarNewyear(
  text: string,
  cal: Calendar,
  newyear: NewYearValue,
  tables: CompiledLocale
): [string, Calendar, NewYearValue] {
  let m = tables.calNyRe.exec(text);
  if (m) {
    const nextCal = tables.locale.calendarWords[m[2].toLowerCase()] ?? cal;
    const nextNy = tables.locale.newyearWords[m[3].toLowerCase()] ?? newyear;
    return [m[1] + m[4], nextCal, nextNy];
  }
  m = tables.calNyIsoRe.exec(text);
  if (m) {
    const nextCal = tables.locale.calendarWords[m[2].toLowerCase()] ?? cal;
    const parts = m[3].split("-").map(Number);
    const nextNy: NewYearValue = [parts[0], parts[1]];
    return [m[1] + m[4], nextCal, nextNy];
  }
  return [text, cal, newyear];
}

function matchNewyear(text: string, newyear: NewYearValue, tables: CompiledLocale): [string, NewYearValue] {
  let m = tables.nyRe.exec(text);
  if (m) {
    const next = tables.locale.newyearWords[m[2].toLowerCase()] ?? newyear;
    return [m[1] + m[3], next];
  }
  m = tables.nyIsoRe.exec(text);
  if (m) {
    const parts = m[2].split("-").map(Number);
    return [m[1] + m[3], [parts[0], parts[1]]];
  }
  return [text, newyear];
}

function matchCalendar(text: string, cal: Calendar, tables: CompiledLocale): [string, Calendar] {
  const m = tables.calRe.exec(text);
  if (m) {
    const next = tables.locale.calendarWords[m[2].toLowerCase()] ?? cal;
    return [m[1] + m[3], next];
  }
  return [text, cal];
}

function matchQuality(text: string, qual: Quality, tables: CompiledLocale): [string, Quality] {
  const m = tables.qualRe.exec(text);
  if (m) {
    const next = tables.locale.qualityWords[m[2].toLowerCase()] ?? qual;
    return [m[1] + m[3], next];
  }
  return [text, qual];
}

interface MatchResult {
  modifier: Modifier;
  calendar: Calendar;
  newyear: NewYearValue;
  quality: Quality;
  dateval: GrampsDate["dateval"];
  text: string;
}

function invertYear(part: DatePart): DatePart {
  return [part[0], part[1], -part[2], part[3]];
}

function matchSpan(text: string, cal: Calendar, ny: NewYearValue, qual: Quality, tables: CompiledLocale): MatchResult | null {
  const m = tables.spanRe.exec(text);
  if (!m) return null;
  const [text1, bc1] = matchBce(m[2], tables);
  let start = parseSubdate(text1, tables, cal);
  if (!start && text1 !== "") return null;
  start = start ?? NO_MATCH;
  if (bc1) start = invertYear(start);

  const [text2, bc2] = matchBce(m[3], tables);
  let stop = parseSubdate(text2, tables, cal);
  if (!stop && text2 !== "") return null;
  stop = stop ?? NO_MATCH;
  if (bc2) stop = invertYear(stop);

  return { modifier: Modifier.SPAN, calendar: cal, newyear: ny, quality: qual, dateval: [...start, ...stop], text: "" };
}

function matchRange(text: string, cal: Calendar, ny: NewYearValue, qual: Quality, tables: CompiledLocale): MatchResult | null {
  const m = tables.rangeRe.exec(text);
  if (!m) return null;
  const [text1, bc1] = matchBce(m[2], tables);
  let start = parseSubdate(text1, tables, cal);
  if (!start && text1 !== "") return null;
  start = start ?? NO_MATCH;
  if (bc1) start = invertYear(start);

  const [text2, bc2] = matchBce(m[3], tables);
  let stop = parseSubdate(text2, tables, cal);
  if (!stop && text2 !== "") return null;
  stop = stop ?? NO_MATCH;
  if (bc2) stop = invertYear(stop);

  return { modifier: Modifier.RANGE, calendar: cal, newyear: ny, quality: qual, dateval: [...start, ...stop], text: "" };
}

const MAX_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** French Republican quarter shorthand, `"Q1 1983"` -> a Range spanning
 * that quarter. Quarter months don't need a leap-year check (no quarter
 * boundary falls in February). */
function matchQuarter(text: string, cal: Calendar, ny: NewYearValue, qual: Quality, tables: CompiledLocale): MatchResult | null {
  const m = tables.quarterRe.exec(text);
  if (!m) return null;
  const quarter = getInt(m[1]);
  const [yearText, bc] = matchBce(m[2], tables);
  let start = parseSubdate(yearText, tables, cal);
  if ((!start && yearText !== "") || (start && (start[0] !== 0 || start[1] !== 0))) return null;
  start = start ?? NO_MATCH;
  if (bc) start = invertYear(start);

  const stopMonth = quarter * 3;
  const stopDay = MAX_DAYS[stopMonth - 1];
  const dateval: GrampsDate["dateval"] = [
    1, stopMonth - 2, start[2], start[3],
    stopDay, stopMonth, start[2], start[3],
  ];
  return { modifier: Modifier.RANGE, calendar: cal, newyear: ny, quality: qual, dateval, text: "" };
}

function matchModifier(
  text: string,
  cal: Calendar,
  ny: NewYearValue,
  qual: Quality,
  bc: boolean,
  tables: CompiledLocale
): MatchResult | null {
  let m = tables.modifierRe.exec(text);
  if (m) {
    let start = parseSubdate(m[2], tables, cal);
    const mod = tables.locale.modifierWords[m[1].toLowerCase()] ?? Modifier.NONE;
    if (!start) return { modifier: Modifier.TEXTONLY, calendar: Calendar.GREGORIAN, newyear: ny, quality: Quality.NONE, dateval: NO_MATCH, text };
    if (bc) start = invertYear(start);
    return { modifier: mod, calendar: cal, newyear: ny, quality: qual, dateval: start, text: "" };
  }

  if (tables.modifierAfterRe) {
    m = tables.modifierAfterRe.exec(text);
    if (m) {
      let start = parseSubdate(m[1], tables, cal);
      const mod = tables.locale.modifierWordsAfterDate[m[2].toLowerCase()] ?? Modifier.NONE;
      if (!start) return { modifier: Modifier.TEXTONLY, calendar: Calendar.GREGORIAN, newyear: ny, quality: Quality.NONE, dateval: NO_MATCH, text };
      if (bc) start = invertYear(start);
      return { modifier: mod, calendar: cal, newyear: ny, quality: qual, dateval: start, text: "" };
    }
  }

  m = tables.bracketAboutRe.exec(text);
  if (m) {
    let start = parseSubdate(m[1], tables, cal);
    if (!start) return { modifier: Modifier.TEXTONLY, calendar: Calendar.GREGORIAN, newyear: ny, quality: Quality.NONE, dateval: NO_MATCH, text };
    if (bc) start = invertYear(start);
    return { modifier: Modifier.ABOUT, calendar: cal, newyear: ny, quality: qual, dateval: start, text: "" };
  }

  return null;
}

/** Port of `DateParser.set_date`: the full matching pipeline. Returns the
 * pieces needed to build a GrampsDate rather than mutating one in place. */
function setDateFromText(rawText: string, tables: CompiledLocale): MatchResult {
  const text0 = rawText.trim();
  let qual = Quality.NONE;
  let cal = Calendar.GREGORIAN;
  let newyear: NewYearValue = 0;

  let [text, nextCal, nextNy] = matchCalendarNewyear(text0, cal, newyear, tables);
  cal = nextCal;
  newyear = nextNy;
  [text, newyear] = matchNewyear(text, newyear, tables);
  [text, cal] = matchCalendar(text, cal, tables);
  [text, qual] = matchQuality(text, qual, tables);

  const span = matchSpan(text, cal, newyear, qual, tables);
  if (span) return span;
  const range = matchRange(text, cal, newyear, qual, tables);
  if (range) return range;
  const quarter = matchQuarter(text, cal, newyear, qual, tables);
  if (quarter) return quarter;

  const [textNoBce, bc] = matchBce(text, tables);
  const modResult = matchModifier(textNoBce, cal, newyear, qual, bc, tables);
  if (modResult) return modResult;

  let subdate = parseSubdate(textNoBce, tables, cal);
  if (!subdate && textNoBce !== "") {
    return { modifier: Modifier.TEXTONLY, calendar: Calendar.GREGORIAN, newyear: 0, quality: Quality.NONE, dateval: NO_MATCH, text: text0 };
  }
  subdate = subdate ?? NO_MATCH;
  if (bc) subdate = invertYear(subdate);
  return { modifier: Modifier.NONE, calendar: cal, newyear, quality: qual, dateval: subdate, text: "" };
}

/** Parse a free-text date string into a structured GrampsDate. Mirrors
 * `DateParser.parse`: on anything this grammar can't make sense of, falls
 * back to a `Modifier.TEXTONLY` date carrying the raw text (matching
 * Gramps desktop's own quick-entry field, which never rejects input --
 * it just stops being "structured"). */
export function parseDate(text: string, options: ParseDateOptions = {}): GrampsDate {
  const locale = resolveLocale(options.locale);
  const tables = compileLocale(locale);
  let result: MatchResult;
  try {
    result = setDateFromText(text, tables);
  } catch {
    return makeDate({ modifier: Modifier.TEXTONLY, text: text.trim() });
  }

  if (result.modifier === Modifier.TEXTONLY) {
    return makeDate({ modifier: Modifier.TEXTONLY, text: result.text });
  }

  const isCompound = result.modifier === Modifier.RANGE || result.modifier === Modifier.SPAN;
  const start = result.dateval.slice(0, 4) as DatePart;
  const stop = isCompound ? (result.dateval.slice(4, 8) as DatePart) : undefined;
  if (!isCompound && isNoMatch(start)) {
    return makeDate({});
  }
  return makeDate({
    modifier: result.modifier,
    quality: result.quality,
    calendar: result.calendar,
    newyear: result.newyear,
    start,
    stop,
  });
}
