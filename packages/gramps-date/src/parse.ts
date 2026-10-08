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

import { Calendar, Modifier, Quality, type NewYear, type DatePart, type GrampsDate, type NewYearValue } from "./types";
import { makeDate } from "./entry";
import { isValidCalendarDate } from "./calendar";
import { type DateLocale, type MonthNames, type GregorianLayout, getLocale } from "./locale";

export interface ParseDateOptions {
  /** Locale code (see locale.ts's registry) or a DateLocale object
   * directly. Defaults to "en". */
  locale?: string | DateLocale;
  /** The locale's numbered format the text was written in, when known (a
   * date field showing its date in the tree's format): that format's own
   * pattern is tried first. Settles formats that read the same as another
   * -- Polish "Miesiąc.Dzień.Rok" ("1.4.1789") vs its day-first numeric. */
  grampsFormat?: number;
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
  /** Patterns from the language's own layouts (text layouts: month names,
   * numbers or Roman numerals -- Icelandic "{day:d}. {long_month} {year}",
   * Greek "{day}-{month}-{year}"), so its output reads back for every
   * calendar where Gramps' patterns don't (Gramps' Hebrew pattern doesn't
   * allow Icelandic's "4. Tammuz 1789"). */
  layoutMatchers: LayoutMatcher[];
  /** Roman month numerals, index = month (Hungarian's own "I."..). */
  roman: readonly string[];
  /** text2Re puts the year (with its optional "/slash") before the month
   * (Hungarian, Japanese, ...) rather than the day. Read from the pattern
   * itself: Gramps decides by the numeric format's order instead, and so
   * misreads Albanian's day-first text dates ("4 janar 1789") because its
   * numeric format happens to be year-first -- a Gramps bug, fixed. */
  text2YearFirst: boolean;
}

/** A calendar's month table plus its two text patterns, compiled from the
 * language's own (Gramps') patterns -- see DateLocale.textPatterns. */
interface LayoutMatcher {
  re: RegExp;
  months: "names" | "number" | "roman";
  /** The numbered format this came from (for ParseDateOptions.grampsFormat). */
  index: number;
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII"];

/** A language's text layouts as matchers, for the layouts its displayer
 * uses with this calendar: each one's full, month-and-year and year-only
 * forms. */
function layoutMatchers(layouts: readonly GregorianLayout[], monthAlt: string, roman: readonly string[]): LayoutMatcher[] {
  const out: LayoutMatcher[] = [];
  layouts.forEach((layout, index) => {
    if (layout.kind !== "text") return;
    const months = layout.months === "number" ? "number" : layout.months === "roman" ? "roman" : "names";
    const monthSource = months === "number" ? "\\d+" : months === "roman" ? reLongestFirst(roman.slice(1).filter(Boolean)).slice(1, -1) : monthAlt;
    for (const template of [layout.template, layout.monthYear ?? "{month} {year}", layout.yearOnly]) {
      if (!template) continue;
      const source = template
        .split(/(\{\w+(?::0?\d*d)?\})/)
        .map((piece: string) => {
          const name = piece.replace(/[{}]|:0?\d*d/g, "");
          if (!piece.startsWith("{")) return literalPattern(piece);
          if (name === "day") return "(?<day>\\d+)";
          if (name === "year") return "(?<year>\\d+)(?<slash>/\\d+)?";
          return `(?<month>${monthSource})`;
        })
        .join("");
      out.push({ re: new RegExp(`^\\s*${source}\\s*$`, "i"), months, index });
    }
  });
  return out;
}

function buildTextTables(toIndex: Map<string, number>, patterns: { text: string; text2: string }, originals: readonly string[] = [], layouts: readonly GregorianLayout[] = [], roman: readonly string[] = ROMAN): CalendarMonthTables {
  // The displayed spellings too: lowercasing isn't always reversible
  // (Turkish "İsfendarmaz").
  const alt = reLongestFirst([...toIndex.keys(), ...originals.filter(Boolean)]);
  return {
    toIndex,
    textRe: new RegExp(patterns.text.replace("{months}", alt), "i"),
    text2Re: new RegExp(patterns.text2.replace("{months}", alt), "i"),
    text2YearFirst: patterns.text2.slice(0, patterns.text2.indexOf("{months}")).includes("(/\\d+)"),
    layoutMatchers: layoutMatchers(layouts, alt.slice(1, -1), roman),
    roman,
  };
}

/** Gramps' parser month table for a calendar, plus the language's own
 * displayed month names (with their prefixes). The second part fixes a
 * Gramps bug: languages without their own parser class (Turkish, Korean,
 * Vietnamese, ...) never get their month names into Gramps' table, so Gramps
 * can't parse the dates it displays ("Ocak 4, 1789"). */
function monthTable(grampsTable: Readonly<Record<string, number>>, ...own: readonly MonthNames[]): Map<string, number> {
  // The language's own names exactly, then Gramps' table, then prefixes of
  // the own names for what Gramps lacks (base-handler languages can't read
  // their own month names). Gramps' table first among abbreviations: it
  // settles clashes ("mar": Finnish maaliskuu, not marraskuu).
  const table = new Map<string, number>();
  for (const names of own) names.forEach((name, month) => { if (month && name) table.set(name.toLowerCase(), month); });
  const prefixes = buildMonthTable(...own);
  for (const [word, month] of Object.entries(grampsTable)) {
    // Gramps' shared table has the bare numbers "1".."12" as month names
    // (added by another language), so Norwegian "4. 1 1789" parsed as
    // "month 4, day 1" -- a Gramps bug; numbers are never month names here.
    // Likewise "-": a month word must contain a letter (Icelandic "1789-11"
    // read as day 1789, month "-").
    if (!/\p{L}/u.test(word)) continue;
    if (!table.has(word.toLowerCase())) table.set(word.toLowerCase(), month);
  }
  for (const [word, month] of prefixes) if (!table.has(word)) table.set(word, month);
  return table;
}

/** The words the parser accepts for each of Gramps' word lists: Gramps'
 * own (DateLocale.*Words) plus every word gramps-date *displays* for that
 * language -- Gramps' parsers don't always accept their displayers' words
 * (Spanish "(Republicano francés)", Korean ranges), which makes dates
 * unreadable after display; a Gramps bug, fixed here. */
interface WordMaps {
  calendars: Map<string, Calendar>;
  qualities: Map<string, Quality>;
  modifiers: Map<string, Modifier>;
  modifiersAfter: Map<string, Modifier>;
  newyears: Map<string, NewYear>;
  bce: string[];
  /** The words as displayed, before lowercasing -- matched too, since
   * lowercasing isn't always reversible (Turkish "İbrani"). */
  originals: { calendars: string[]; qualities: string[]; modifiers: string[]; modifiersAfter: string[] };
}

function lowerMap<T>(record: Readonly<Record<string, T>>): Map<string, T> {
  return new Map(Object.entries(record).map(([word, value]) => [word.toLowerCase(), value]));
}

/** A display template ("{quality}vor {date}{calendar}") split into the
 * literal text before and after the date, quality/calendar removed. */
function templateAround(template: string, slot: string): [string, string] {
  const bare = template.replace("{quality}", "").replace("{calendar}", "");
  const at = bare.indexOf(slot);
  return at < 0 ? ["", ""] : [bare.slice(0, at).trim(), bare.slice(at + slot.length).trim()];
}

function wordMaps(locale: DateLocale): WordMaps {
  const maps: WordMaps = {
    calendars: lowerMap(locale.calendarWords),
    qualities: lowerMap(locale.qualityWords),
    modifiers: lowerMap(locale.modifierWords),
    modifiersAfter: lowerMap(locale.modifierWordsAfterDate),
    newyears: lowerMap(locale.newyearWords),
    bce: [...locale.bceWords],
    originals: { calendars: [], qualities: [], modifiers: [], modifiersAfter: [] },
  };
  const add = <T,>(kind: keyof WordMaps["originals"], map: Map<string, T>, word: string, value: T) => {
    if (!word) return;
    maps.originals[kind].push(word);
    if (!map.has(word.toLowerCase())) map.set(word.toLowerCase(), value);
  };
  locale.calendarNames.forEach((name, calendar) => add("calendars", maps.calendars, name, calendar as Calendar));
  locale.qualityStrings.forEach((word, quality) => add("qualities", maps.qualities, word.trim(), quality as Quality));
  for (const templates of locale.templates) {
    for (const modifier of [Modifier.BEFORE, Modifier.AFTER, Modifier.ABOUT, Modifier.FROM, Modifier.TO]) {
      const [before, after] = templateAround(templates.modifiers[modifier] ?? "", "{date}");
      add("modifiers", maps.modifiers, before, modifier);
      add("modifiersAfter", maps.modifiersAfter, after, modifier);
    }
  }
  const bceMarker = locale.bceFormat.replace("%s", "").trim();
  if (bceMarker && !maps.bce.includes(bceMarker)) maps.bce.push(bceMarker);
  return maps;
}

/** A template's literal text length (placeholders removed). */
function literalLength(template: string): number {
  return template.replace(/\{\w+\}/g, "").trim().length;
}

function distinct(items: readonly string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function firstMatch(res: readonly RegExp[], text: string): RegExpExecArray | null {
  for (const re of res) {
    const m = re.exec(text);
    if (m) return m;
  }
  return null;
}

/** numericFormatRes' patterns: %d/%e -> day, %m/%b/%B -> month number,
 * %Y -> year, %a/%A -> a weekday word; literal text as is (spaces
 * flexible). The second drops the day and one adjacent delimiter, as the
 * display does for a date without a day. */
function numericFormatRes(format: string, weekdays: readonly string[]): RegExp[] {
  const weekday = reLongestFirst(weekdays.filter(Boolean)).slice(1, -1);
  const toRe = (fmt: string) => {
    let source = "";
    for (const piece of fmt.split(/(%[a-zA-Z])/)) {
      if (piece === "%d" || piece === "%e") source += "(?<day>\\d+)";
      else if (piece === "%m" || piece === "%b" || piece === "%B") source += "(?<month>\\d+)";
      else if (piece === "%Y") source += "(?<year>\\d+)";
      // Only a real weekday name, and optional (it's blank without a day).
      else if (piece === "%a" || piece === "%A") source += `(?:${weekday})?`;
      // Literal text with its own spacing: a space there means at least
      // one ("%d %b, %Y" must not read "11" as day 1, month 1).
      else if (piece) source += literalPattern(piece);
    }
    return new RegExp(`^\\s*${source}\\s*$`, "i");
  };
  // A blank weekday leaves its space behind; read without it too.
  const withoutWeekday = (fmt: string) => fmt.replace(/%[aA]\s*/g, "").trim();
  const normalized = format.replace("%e", "%d");
  const i = normalized.indexOf("%d");
  const noDay = i < 0 ? normalized : normalized.length === i + 2 ? normalized.slice(0, Math.max(i - 1, 0)) : normalized.slice(0, i) + normalized.slice(i + 3);
  return [
    toRe(normalized), toRe(noDay), toRe(withoutWeekday(normalized)), toRe(withoutWeekday(noDay)),
    // A bare year (Icelandic's own pattern demands a weekday, so Gramps
    // can't read "1789" back).
    /^\s*(?<year>\d+)\s*$/,
  ];
}

/** One of Gramps' exported parser patterns (DateLocale.parserPatterns),
 * its word-list placeholders filled from `words`. */
function pattern(locale: DateLocale, name: keyof DateLocale["parserPatterns"], words: WordMaps): RegExp {
  const { source, ignoreCase } = locale.parserPatterns[name];
  const filled = source
    .replace("{bce}", reLongestFirst(words.bce))
    .replace("{qualities}", reLongestFirst([...words.qualities.keys(), ...words.originals.qualities]))
    .replace("{modifiersAfter}", reLongestFirst([...words.modifiersAfter.keys(), ...words.originals.modifiersAfter]))
    .replace("{modifiers}", reLongestFirst([...words.modifiers.keys(), ...words.originals.modifiers]))
    .replace(/\{calendars\}/g, reLongestFirst([...words.calendars.keys(), ...words.originals.calendars]))
    .replace("{newyears}", reLongestFirst([...words.newyears.keys()]));
  return new RegExp(filled, ignoreCase ? "i" : "");
}

/** A template's literal text as a pattern, honoring its own spacing: where
 * the template has whitespace, at least one space is required (so "al"
 * can't match inside "Ŝaŭŭal"); where it has none, none is needed (Korean
 * "{start}에서", Vietnamese "sau{date}"). */
function literalPattern(text: string): string {
  if (text === "") return "";
  if (text.trim() === "") return "\\s+";
  const lead = /^\s/.test(text) ? "\\s+" : "";
  const tail = /\s$/.test(text) ? "\\s+" : "";
  // A Hebrew maqaf ("־") joins a prefix to the date only when the date
  // starts with a non-Hebrew character (_date_he.py add_prefix), so it's
  // optional when reading.
  const words = text.trim().split(/\s+/).map((w) => escapeRegExp(w).replace(/־/g, "־?")).join("\\s+");
  return lead + words + tail;
}

/** A display template as patterns, tried after Gramps' own so whatever
 * gramps-date displays reads back even where the language's Gramps parser
 * has no such pattern (Korean ranges, Vietnamese "sau1789"). The calendar
 * is removed (matched before this, wherever it is); the quality is matched
 * where the template puts it (Korean puts it last) -- or left out, as a
 * second pattern. `outer` captures the date ({date}) or both dates as
 * `body`, which `middle` (global) then splits, every way it can. */
interface TemplateMatcher {
  outer: RegExp;
  middle: RegExp | null;
}

function templateMatchers(template: string, qualities: string): TemplateMatcher[] {
  if (!template) return [];
  const noCalendar = template.replace("{calendar}", "");
  return [noCalendar.replace("{quality}", ""), noCalendar.replace("{quality}", "\u0000")].map((variant) => {
    const piece = (text: string) =>
      text
        .split("\u0000")
        .map(literalPattern)
        .join(`(?<quality>${qualities})\\s*`);
    if (variant.includes("{date}")) {
      const [lead, tail] = variant.split("{date}");
      return { outer: new RegExp(`^\\s*${piece(lead.trimStart())}(?<date>.+?)${piece(tail.trimEnd())}\\s*$`, "i"), middle: null };
    }
    const [lead, rest] = variant.split("{start}");
    const [middle, tail] = rest.split("{stop}");
    return {
      outer: new RegExp(`^\\s*${piece(lead.trimStart())}(?<body>.+?)${piece(tail.trimEnd())}\\s*$`, "i"),
      middle: new RegExp(piece(middle) || "\\s+", "gi"),
    };
  });
}

interface CompiledLocale {
  locale: DateLocale;
  months: Record<Calendar, CalendarMonthTables>;
  words: WordMaps;
  spanTemplates: TemplateMatcher[];
  rangeTemplates: TemplateMatcher[];
  /** Template-derived patterns for the plain and modifier templates
   * (templateMatchers), tried after Gramps'. */
  modifierTemplates: [Modifier, TemplateMatcher][];
  /** Patterns from the language's own numeric format ("%d %b, %Y" -> day,
   * month number, year) -- full and without a day -- so its numeric output
   * reads back even where Gramps' numeric pattern can't (Arabic, Tamil,
   * Norwegian). */
  numericFormatRes: RegExp[];
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
  /** The calendar in parentheses at the very start (matchCalendar). */
  calLeadRe: RegExp;
  numericRe: RegExp;
  isoRe: RegExp;
  isoTimestampRe: RegExp;
  rfcRe: RegExp;
  todayRe: RegExp;
  bceRe: RegExp;
  /** The BCE marker before the date (Hungarian "i. e. 90"): Gramps'
   * pattern wants it after, so its own Hungarian output doesn't read back. */
  bceLeadRe: RegExp;
  /** ParseDateOptions.grampsFormat, as an index into the language's layouts. */
  hintLayout?: number;
}

const compiledCache = new Map<string, CompiledLocale>();

/** The language's parser: Gramps' own patterns (each language overrides
 * some in init_strings) and month tables, compiled once per language. */
function compileLocale(locale: DateLocale): CompiledLocale {
  const cached = compiledCache.get(locale.code);
  if (cached) return cached;

  const t = locale.monthTables;
  // Each calendar reads back with the layouts its display uses (layoutFor
  // in display.ts): the language's own for Gregorian -- or every calendar,
  // for Hungarian/Swedish -- and its base ones otherwise.
  const own = locale.gregorianLayouts;
  const other = locale.layoutsForAllCalendars ? own : locale.baseLayouts;
  const roman = locale.romanMonths ?? ROMAN;
  const gregorian = monthTable(t.gregorian, locale.longMonths, locale.shortMonths);
  const months: Record<Calendar, CalendarMonthTables> = {
    // Julian shares the Gregorian patterns and table, as in _parse_julian.
    [Calendar.GREGORIAN]: buildTextTables(gregorian, locale.textPatterns.gregorian, [...locale.longMonths, ...locale.shortMonths], own, roman),
    [Calendar.JULIAN]: buildTextTables(gregorian, locale.textPatterns.gregorian, [...locale.longMonths, ...locale.shortMonths], other, roman),
    [Calendar.SWEDISH]: buildTextTables(monthTable(t.swedish, locale.longMonths, locale.shortMonths), locale.textPatterns.swedish, [...locale.longMonths, ...locale.shortMonths], other, roman),
    [Calendar.HEBREW]: buildTextTables(monthTable(t.hebrew, locale.hebrewMonths), locale.textPatterns.hebrew, locale.hebrewMonths, other, roman),
    [Calendar.FRENCH]: buildTextTables(monthTable(t.french, locale.frenchMonths), locale.textPatterns.french, locale.frenchMonths, other, roman),
    [Calendar.ISLAMIC]: buildTextTables(monthTable(t.islamic, locale.islamicMonths), locale.textPatterns.islamic, locale.islamicMonths, other, roman),
    [Calendar.PERSIAN]: buildTextTables(monthTable(t.persian, locale.persianMonths), locale.textPatterns.persian, locale.persianMonths, other, roman),
  };

  const words = wordMaps(locale);
  const p = (name: keyof DateLocale["parserPatterns"]) => pattern(locale, name, words);
  const qualityAlt = reLongestFirst([...words.qualities.keys(), ...words.originals.qualities]).slice(1, -1);
  const compiled: CompiledLocale = {
    locale,
    months,
    words,
    spanTemplates: distinct(locale.templates.map((t) => t.span)).flatMap((t) => templateMatchers(t, qualityAlt)),
    rangeTemplates: distinct(locale.templates.map((t) => t.range)).flatMap((t) => templateMatchers(t, qualityAlt)),
    // Most literal text first, so a plain "{quality}{date}" can't claim
    // "tính toánto 1789" before "{quality}to {date}" does ("to" is also a
    // month word in Gramps' shared table).
    modifierTemplates: [Modifier.NONE, Modifier.BEFORE, Modifier.AFTER, Modifier.ABOUT, Modifier.FROM, Modifier.TO]
      .flatMap((modifier) =>
        distinct(locale.templates.map((t) => t.modifiers[modifier] ?? "")).map((t): [Modifier, string] => [modifier, t]),
      )
      .sort(([, a], [, b]) => literalLength(b) - literalLength(a))
      .flatMap(([modifier, t]) => templateMatchers(t, qualityAlt).map((matcher): [Modifier, TemplateMatcher] => [modifier, matcher])),
    numericFormatRes: numericFormatRes(locale.numericFormat, [...locale.shortDays, ...locale.longDays]),
    bceRe: p("bce"),
    bceLeadRe: new RegExp(`^\\s*${reLongestFirst(words.bce)}\\s+(.*)$`),
    calRe: p("calendar"),
    calNyRe: p("calendarNewyear"),
    calNyIsoRe: p("calendarNewyearIso"),
    nyRe: p("newyear"),
    nyIsoRe: p("newyearIso"),
    qualRe: p("quality"),
    spanRe: p("span"),
    rangeRe: p("range"),
    quarterRe: p("quarter"),
    modifierRe: p("modifier"),
    // Gramps compiles "(.*)\\s+()" when there are no after-date words.
    modifierAfterRe: words.modifiersAfter.size ? p("modifierAfter") : null,
    bracketAboutRe: p("aboutBrackets"),
    calLeadRe: new RegExp(`^\\s*\\(${reLongestFirst([...words.calendars.keys(), ...words.originals.calendars])}\\)\\s*(.*)$`, "i"),
    numericRe: p("numeric"),
    isoRe: p("iso"),
    isoTimestampRe: p("isoTimestamp"),
    rfcRe: p("rfc"),
    todayRe: p("today"),
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
    } else if (!validFor(calendar, year, month, day)) {
      return null;
    }
    return [day, month, year, slash];
  }

  m = tables.text2Re.exec(text);
  if (m) {
    let day: number, month: number, year: number | null, slash: boolean;
    if (tables.text2YearFirst) {
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
    if (!validFor(calendar, year, month, day)) return null;
    return [day, month, year, slash];
  }

  // The language's own month-name layouts (see layoutMatchers); number and
  // Roman-numeral ones come last, in parseSubdate.
  return matchLayouts(text, tables, calendar, (m) => m.months === "names");
}

/** Port of `_parse_subdate`: month-name text, then ISO `Y-M-D`, then bare
 * numeric, then "today"/"$T". */
/** _parse_subdate's `check`: Gramps validates Gregorian, Julian, Swedish
 * and French Republican dates only; Hebrew, Islamic and Persian ones pass
 * as given. */
/** The first of a calendar's layout matchers (`which`) that reads `text`
 * as a valid date. */
function matchLayouts(text: string, tables: CalendarMonthTables, calendar: Calendar, which: (m: LayoutMatcher) => boolean): DatePart | null {
  const roman = tables.roman;
  for (const matcher of tables.layoutMatchers) {
    if (!which(matcher)) continue;
    const m = matcher.re.exec(text);
    if (!m) continue;
    const word = m.groups!.month;
    const month = !word ? 0
      : matcher.months === "number" ? getInt(word)
        : matcher.months === "roman" ? roman.findIndex((r) => r.toLowerCase() === word.toLowerCase())
          : tables.toIndex.get(word.toLowerCase()) ?? 0;
    const day = m.groups!.day ? getInt(m.groups!.day) : 0;
    const slash = !!m.groups!.slash;
    const year = getInt(m.groups!.year) + (slash ? 1 : 0);
    if (month < 0) continue;
    if (slash ? isValidCalendarDate(Calendar.JULIAN, year, month, day) : validFor(calendar, year, month, day)) return [day, month, year, slash];
  }
  return null;
}

function validFor(calendar: Calendar, year: number, month: number, day: number): boolean {
  // No calendar has more than 31 days in a month (Gramps checks Hebrew,
  // Islamic and Persian dates not at all, so Swedish "1789 Tammuz 4" read
  // as day 1789 through the Hebrew pattern).
  if (day > 31) return false;
  // A real month whatever the calendar: 1-12, or 13 for Hebrew (Adar II)
  // and French Republican (the extra days). (isValidCalendarDate accepts
  // any month when the day is 0.)
  if (month > 13 || (month === 13 && calendar !== Calendar.HEBREW && calendar !== Calendar.FRENCH)) return false;
  switch (calendar) {
    case Calendar.GREGORIAN:
    case Calendar.JULIAN:
    case Calendar.SWEDISH:
    case Calendar.FRENCH:
      return isValidCalendarDate(calendar, year, month, day);
    default:
      return true;
  }
}

function parseSubdate(text: string, tables: CompiledLocale, calendar: Calendar): DatePart | null {
  const calTables = tables.months[calendar];
  // The format the text is known to be in goes first (ParseDateOptions.grampsFormat).
  if (tables.hintLayout !== undefined) {
    const { locale } = tables;
    const own = calendar === Calendar.GREGORIAN || locale.layoutsForAllCalendars;
    const index = own ? tables.hintLayout : Math.min(tables.hintLayout, locale.baseLayouts.length - 1);
    const hinted = matchLayouts(text, calTables, calendar, (m) => m.index === index);
    if (hinted) return hinted;
  }

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
    if (validFor(calendar, year, month, day)) return [day, month, year, false];
    return null;
  }

  // Database timestamps: YYYYMMDD, "YYYYMMDD HH:MM[:SS]", YYYYMMDDHHMMSS.
  m = tables.isoTimestampRe.exec(text);
  if (m) {
    const [year, month, day] = [getInt(m[1]), getInt(m[2]), getInt(m[3])];
    return validFor(calendar, year, month, day) ? [day, month, year, false] : null;
  }

  // RFC 2822 ("Sun, 12 Mar 1854 ..."), English month abbreviations.
  m = tables.rfcRe.exec(text);
  if (m) {
    const [day, month, year] = [getInt(m[3]), tables.locale.rfcMonths[m[4]] ?? 0, getInt(m[5])];
    return validFor(calendar, year, month, day) ? [day, month, year, false] : null;
  }

  m = tables.numericRe.exec(text);
  if (m) {
    if (m[1] === undefined && m[2] === undefined && m[3] === undefined && m[4] === undefined && m[5] === undefined) {
      return null;
    }
    // Icelandic ("%a %e.%b %Y"): a leading weekday group shifts the rest.
    if (tables.locale.numericWeekdayFirst) m = [m[0], ...m.slice(2)] as unknown as RegExpExecArray;
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
    // Not valid this way round: the layouts below may still read it.
    if (validFor(calendar, year, month, day)) return [day, month, year, false];
  }

  for (const re of tables.numericFormatRes) {
    const nm = re.exec(text);
    if (!nm) continue;
    const day = nm.groups!.day ? getInt(nm.groups!.day) : 0;
    const month = nm.groups!.month ? getInt(nm.groups!.month) : 0;
    const year = getInt(nm.groups!.year);
    if (validFor(calendar, year, month, day)) return [day, month, year, false];
  }

  // Month-number and Roman-numeral layouts last: they overlap the numeric
  // format (Greek "4-1-1789", Polish "1.4.1789"), whose reading wins
  // unless the format is known.
  const numbered = matchLayouts(text, calTables, calendar, (m) => m.months !== "names");
  if (numbered) return numbered;

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
  const lead = tables.bceLeadRe.exec(text);
  if (lead) return [lead[2], true];
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
    const nextCal = tables.words.calendars.get(m[2].toLowerCase()) ?? cal;
    const nextNy = tables.words.newyears.get(m[3].toLowerCase()) ?? newyear;
    return [m[1] + m[4], nextCal, nextNy];
  }
  m = tables.calNyIsoRe.exec(text);
  if (m) {
    const nextCal = tables.words.calendars.get(m[2].toLowerCase()) ?? cal;
    const parts = m[3].split("-").map(Number);
    const nextNy: NewYearValue = [parts[0], parts[1]];
    return [m[1] + m[4], nextCal, nextNy];
  }
  return [text, cal, newyear];
}

function matchNewyear(text: string, newyear: NewYearValue, tables: CompiledLocale): [string, NewYearValue] {
  let m = tables.nyRe.exec(text);
  if (m) {
    const next = tables.words.newyears.get(m[2].toLowerCase()) ?? newyear;
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
    const next = tables.words.calendars.get(m[2].toLowerCase()) ?? cal;
    return [m[1] + m[3], next];
  }
  // Korean writes the calendar first, "(율리우스력)1788/9-11-04...", which
  // Gramps' pattern (it needs a space before the parenthesis) misses.
  const lead = tables.calLeadRe.exec(text);
  if (lead) return [lead[2], tables.words.calendars.get(lead[1].toLowerCase()) ?? cal];
  return [text, cal];
}

function matchQuality(text: string, qual: Quality, tables: CompiledLocale): [string, Quality] {
  const m = tables.qualRe.exec(text);
  if (m) {
    const next = tables.words.qualities.get(m[2].toLowerCase()) ?? qual;
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

/** One half of a range/span: its date, BCE handled; null if it isn't one. */
function compoundPart(text: string, tables: CompiledLocale, cal: Calendar): DatePart | null {
  const [bare, bc] = matchBce(text, tables);
  const part = parseSubdate(bare, tables, cal);
  if (!part) return bare === "" ? NO_MATCH : null;
  return bc ? invertYear(part) : part;
}

/** A range or span: Gramps' pattern first, then the display templates,
 * trying every split between the two dates (`middle`) until both halves
 * read as dates (Tamil writes them separated by just a space). */
function matchCompound(
  modifier: Modifier.SPAN | Modifier.RANGE, re: RegExp, templates: TemplateMatcher[],
  text: string, cal: Calendar, ny: NewYearValue, qual: Quality, tables: CompiledLocale,
): MatchResult | null {
  const result = (start: DatePart, stop: DatePart, quality: Quality): MatchResult =>
    ({ modifier, calendar: cal, newyear: ny, quality, dateval: [...start, ...stop], text: "" });
  const m = re.exec(text);
  if (m) {
    const start = compoundPart(m.groups!.start, tables, cal);
    const stop = compoundPart(m.groups!.stop, tables, cal);
    if (start && stop) return result(start, stop, qual);
  }
  for (const { outer, middle } of templates) {
    const om = outer.exec(text);
    if (!om || !middle) continue;
    const body = om.groups!.body;
    const quality = om.groups!.quality ? tables.words.qualities.get(om.groups!.quality.toLowerCase()) ?? qual : qual;
    for (const split of body.matchAll(middle)) {
      const start = compoundPart(body.slice(0, split.index).trim(), tables, cal);
      const stop = compoundPart(body.slice(split.index! + split[0].length).trim(), tables, cal);
      if (start && stop && start !== NO_MATCH && stop !== NO_MATCH) return result(start, stop, quality);
    }
  }
  return null;
}

function matchSpan(text: string, cal: Calendar, ny: NewYearValue, qual: Quality, tables: CompiledLocale): MatchResult | null {
  return matchCompound(Modifier.SPAN, tables.spanRe, tables.spanTemplates, text, cal, ny, qual, tables);
}

function matchRange(text: string, cal: Calendar, ny: NewYearValue, qual: Quality, tables: CompiledLocale): MatchResult | null {
  return matchCompound(Modifier.RANGE, tables.rangeRe, tables.rangeTemplates, text, cal, ny, qual, tables);
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

/** Gramps' match_modifier, except that a reading which doesn't yield a
 * date falls through to the next one instead of giving up (Gramps' Hebrew
 * parser takes "מ" -- "from", no space needed -- off "מרץ", March, and then
 * makes the date text-only: a Gramps bug). */
function matchModifier(
  text: string,
  cal: Calendar,
  ny: NewYearValue,
  qual: Quality,
  bc: boolean,
  tables: CompiledLocale
): MatchResult | null {
  const result = (modifier: Modifier, start: DatePart, quality = qual): MatchResult =>
    ({ modifier, calendar: cal, newyear: ny, quality, dateval: bc ? invertYear(start) : start, text: "" });

  let m = tables.modifierRe.exec(text);
  if (m) {
    const start = parseSubdate(m[2], tables, cal);
    if (start) return result(tables.words.modifiers.get(m[1].toLowerCase()) ?? Modifier.NONE, start);
  }

  if (tables.modifierAfterRe) {
    m = tables.modifierAfterRe.exec(text);
    if (m) {
      const start = parseSubdate(m[1], tables, cal);
      if (start) return result(tables.words.modifiersAfter.get(m[2].toLowerCase()) ?? Modifier.NONE, start);
    }
  }

  m = tables.bracketAboutRe.exec(text);
  if (m) {
    const start = parseSubdate(m[1], tables, cal);
    if (start) return result(Modifier.ABOUT, start);
  }

  // The plain date first: a template whose literal text is empty (most
  // languages' "{quality}{date}") must not shadow Gramps' own reading.
  if (parseSubdate(text, tables, cal)) return null;

  for (const [modifier, { outer }] of tables.modifierTemplates) {
    const tm = outer.exec(text);
    const start = tm ? parseSubdate(tm.groups!.date, tables, cal) : null;
    if (start) {
      const quality = tm!.groups!.quality ? tables.words.qualities.get(tm!.groups!.quality.toLowerCase()) ?? qual : qual;
      return result(modifier, start, quality);
    }
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
    // The user's input as typed. (Gramps keeps the text left after
    // stripping the calendar/quality/BCE parts -- "-44" from "-44 B.C.E."
    // -- losing part of what was entered; a Gramps bug, not copied.)
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
  const compiled = compileLocale(locale);
  const tables = options.grampsFormat === undefined ? compiled
    : { ...compiled, hintLayout: locale.formatIndex[options.grampsFormat] ?? options.grampsFormat };
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
  // Nothing to set: an empty date. (Gramps makes "" a text-only date with
  // empty text, via a DateError it catches -- a Gramps bug, not copied.)
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
