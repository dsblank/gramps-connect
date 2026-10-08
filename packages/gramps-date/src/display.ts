// Locale-aware Date -> display-string formatting.
//
// Translated from gramps/gen/datehandler/_datedisplay.py's DateDisplay
// base class and DateDisplayEn (which is just `display =
// DateDisplay.display_formatted`, no overrides of its own -- English is
// the "base" behavior everything else localizes from). Simplifications
// from the original, called out where they matter:
//   - No Lexeme/grammatical-inflection system (_datedisplay.py's
//     FORMATS_long_month_year/format_long_month_year machinery) -- only
//     matters for languages with case-marked month names (Russian and
//     similar); English (and this package's only locale so far) never
//     hits that branch in the original either (`long_months[1]` has no
//     `.forms` attribute for English -- see Python's own `hasattr`
//     check), so the simplification is exact for "en" and a known gap
//     for a locale that needs it.
//   - Numeric format (%b/%B/%a/%A weekday-name substitution) only
//     implements %m/%d/%Y-style tokens -- the "en" locale's own
//     numericFormat never contains the others; a locale that needs them
//     (ar_EG, is_IS, ta_IN in the original) would need this extended.
//
// Original:
//   Gramps - a GTK+/GNOME based genealogy program
//   Copyright (C) 2004-2006  Donald N. Allingham
//   Copyright (C) 2013       Vassilii Khachaturov
//   Copyright (C) 2014-2018  Paul Franklin
//   Licensed under the GNU General Public License, version 2 or later.
//   https://github.com/gramps-project/gramps/blob/master/gramps/gen/datehandler/_datedisplay.py

import { Calendar, Modifier, NewYearValue, Quality, type DatePart, type GrampsDate, getStartDate, getStopDate } from "./types";
import { type DateLocale, type InflectKey, type MonthFormLists, getLocale } from "./locale";
import { BASE_LAYOUTS, type GregorianLayout } from "./layouts";

// In its own module so locale files can use it without a display.ts <->
// locale.ts import cycle; re-exported here for existing importers.
import { DateFormat } from "./formats";
export { DateFormat };

export interface FormatDateOptions {
  /** Locale code (see locale.ts's registry) or a DateLocale object
   * directly. Defaults to "en". */
  locale?: string | DateLocale;
  format?: DateFormat;
  /** One of the locale's own numbered formats (DateLocale.formatNames),
   * overriding `format` -- for the formats a language has beyond the six
   * (German 6, "numeric with leading zeros"; French 4/5/8). */
  grampsFormat?: number;
}

// Not locale-translated in the original either -- a plain class attribute
// on DateDisplay, never routed through DateStrings/gettext.
const NEWYEAR_NAMES = ["", "Mar1", "Mar25", "Sep1"];

function resolveLocale(locale: string | DateLocale | undefined): DateLocale {
  if (locale === undefined) return getLocale("en");
  if (typeof locale === "string") return getLocale(locale);
  return locale;
}

function formatBce(value: string, datePart: DatePart, locale: DateLocale): string {
  return datePart[2] < 0 ? locale.bceFormat.replace("%s", value) : value;
}

function slashYear(val: number, slash: boolean): string {
  const v = Math.abs(val);
  if (!slash) return String(v);
  if ((v - 1) % 100 === 99) return `${v - 1}/${v % 1000}`;
  if ((v - 1) % 10 === 9) return `${v - 1}/${v % 100}`;
  return `${v - 1}/${v % 10}`;
}

/** `format_extras`: the " (Julian)" / " (Julian, Mar25)" suffix for a
 * non-Gregorian calendar and/or non-Jan-1 new year. */
export function formatExtras(calendar: Calendar, newyear: NewYearValue, locale: DateLocale): string {
  const calName = locale.calendarNames[calendar] ?? "";
  const newyearName = Array.isArray(newyear)
    ? `${newyear[0]}-${newyear[1]}`
    : NEWYEAR_NAMES[newyear] ?? "Err";
  const parts = [calName, newyearName].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/** `display_iso`: YYYY-MM-DD, or YYYY / YYYY-MM for a partial date,
 * B.C.E.-suffixed for a negative year. Format 0, and also the raw
 * fallback whenever a month is zero but a day isn't (see dd_dformat02.. --
 * an edge case the original notes at gramps bug 8477). */
export function displayIso(datePart: DatePart, locale: DateLocale): string {
  const [day, month, year, slash] = datePart;
  const y = slashYear(year, slash);
  let value: string;
  if (day === 0 && month === 0) value = y;
  else if (day === 0) value = `${y}-${String(month).padStart(2, "0")}`;
  else value = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return formatBce(value, datePart, locale);
}

/** Python's s[start:end] (negative indices from the end, clamped). */
function pySlice(text: string, start: number, end: number): string {
  const norm = (i: number) => (i < 0 ? Math.max(text.length + i, 0) : Math.min(i, text.length));
  return text.slice(norm(start), norm(end));
}

/** Python's str.replace: every occurrence; an empty `find` leaves the
 * text unchanged here (as replacing "" with "" does). */
function pyReplaceAll(text: string, find: string, replacement: string): string {
  return find === "" ? text : text.split(find).join(replacement);
}

/** `_get_short_weekday` / `_get_long_weekday`: the weekday name for the
 * raw numbers read as a proleptic-Gregorian date (whatever the calendar,
 * as Gramps does), "" when there's no day/month, a 13th month, or a BCE
 * or out-of-range year. */
function weekdayName(datePart: DatePart, names: readonly string[]): string {
  const [day, month, year] = datePart;
  if (day === 0 || month === 0 || month === 13 || year > 9999 || year < 0) return "";
  const d = new Date(Date.UTC(2000, month - 1, day));
  d.setUTCFullYear(year);
  // Python weekday() is Monday=0; Gramps indexes Sunday=1 .. Saturday=7.
  const pythonWeekday = (d.getUTCDay() + 6) % 7;
  return names[((pythonWeekday + 1) % 7) + 1] ?? "";
}

/** `dd_dformat01`, the base numeric format, faithfully: %b/%B become the
 * month *number*, %a/%A the weekday, a zero day goes with its delimiter
 * (Python replace -- every occurrence -- and slicing), the year unsigned,
 * and "-" becomes "/". A bare year goes through the language's year
 * localization. */
function formatNumeric(datePart: DatePart, locale: DateLocale): string {
  const [day, month, year, slash] = datePart;
  if (slash) return displayIso(datePart, locale);
  // Unsigned: the BCE marker says it (Gramps writes "-44 B.C.E." here,
  // which doesn't read back -- a Gramps bug, not copied).
  if (day === 0 && month === 0) return String(Math.abs(year)) + locale.yearSuffix;

  // %e (day, no padding -- Bulgarian) is handled as %d; Gramps leaves it in
  // the output as "%e" (a Gramps bug, not copied).
  let value = locale.numericFormat.replace("%e", "%d").replace("%m", String(month));
  value = value.replace("%b", String(month)).replace("%B", String(month));
  value = value.replace("%a", weekdayName(datePart, locale.shortDays)).replace("%A", weekdayName(datePart, locale.longDays));
  if (day === 0) {
    const i = value.indexOf("%d");
    value =
      value.length === i + 2
        ? pyReplaceAll(value, pySlice(value, i - 1, i + 2), "") // delimiter to the left
        : pyReplaceAll(value, pySlice(value, i, i + 3), ""); // delimiter to the right
  }
  value = value.replace("%d", String(day));
  value = value.replace("%Y", String(Math.abs(year)));
  return value.replace(/-/g, "/");
}

interface MonthTables {
  long: readonly string[];
  short: readonly string[];
  /** Which DateLocale.inflection.forms lists these are. */
  longForms: MonthFormLists;
  shortForms: MonthFormLists;
}

function monthTablesFor(calendar: Calendar, locale: DateLocale): MonthTables {
  // Only Gregorian/Julian/Swedish (which display identically -- see
  // _display_julian = _display_swedish = _display_gregorian in the
  // original) have distinct long/short month tables; the other
  // calendars have no abbreviated form in Gramps at all.
  const one = (months: readonly string[], forms: MonthFormLists): MonthTables => ({ long: months, short: months, longForms: forms, shortForms: forms });
  switch (calendar) {
    case Calendar.HEBREW:
      return one(locale.hebrewMonths, "hebrew");
    case Calendar.FRENCH:
      return one(locale.frenchMonths, "french");
    case Calendar.ISLAMIC:
      return one(locale.islamicMonths, "islamic");
    case Calendar.PERSIAN:
      return one(locale.persianMonths, "persian");
    default:
      return { long: locale.longMonths, short: locale.shortMonths, longForms: "long", shortForms: "short" };
  }
}

/** A range's or span's two dates take the same case (Gramps' own comment
 * on FORMATS_long_month_year): where a translation names a form the month
 * doesn't have (Czech "between" -> "X"; Gramps raises KeyError), its
 * partner's is used. */
const PARTNER_KEY: Partial<Record<InflectKey, InflectKey>> = { between: "and", and: "between", from: "to", to: "from" };

/** A month name in a grammatical context (format_long_month and
 * format_long_month_year, with DateDisplayRU/FI's day forms): the word,
 * plus the month-and-year template when the list is inflected. */
function inflectedMonth(
  month: number,
  plain: string,
  list: MonthFormLists,
  short: boolean,
  locale: DateLocale,
  inflect: InflectKey,
  form?: string,
): { word: string; template?: string } | null {
  const inflection = locale.inflection;
  const forms = inflection?.forms[list];
  if (!inflection || !forms) return null;
  const formats = short ? inflection.shortMonthYear : inflection.longMonthYear;
  const format = formats[inflect] ?? formats[""];
  const lexeme = forms[month];
  const partner = PARTNER_KEY[inflect];
  const pick = (name: string | null | undefined) => (name ? lexeme?.[name] : undefined);
  const word = form !== undefined
    ? pick(form)
    : format.form ? pick(format.form) ?? (partner ? pick(formats[partner].form) : undefined) : plain;
  return { word: word ?? plain, template: form !== undefined ? "{month} {year}" : format.template };
}

/** Python str.format for the text templates: {day} / {day:d},
 * {long_month}, {short_month}, {year}. */
/** Python str.format for the text templates: {name}, {name:d}, and
 * zero-padded {name:02d}. */
function fillTextTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)(?::(0\d+)?d)?\}/g, (match, key: string, pad?: string) => {
    const value = values[key];
    if (value === undefined) return match;
    return pad ? value.padStart(Number(pad), "0") : value;
  });
}

/** A "text" layout (dd_dformat02..05, or a language's own month-name
 * format): the template for a full date; "{month} {year}" without a day;
 * the year alone without a month (localized for the base layouts). */
const ROMAN_MONTHS = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII"];

/** A "text" layout (dd_dformat02..05, or a language's own format): the
 * template for a full date; `monthYear` without a day; the year alone
 * without a month (localized for the base layouts). */
function formatText(datePart: DatePart, tables: MonthTables, locale: DateLocale, layout: Extract<GregorianLayout, { kind: "text" }>, calendar: Calendar, inflect: InflectKey): string {
  const [day, month, year, slash] = datePart;
  if (slash && layout.isoWhenSlash) return displayIso(datePart, locale);
  const y = slashYear(year, slash);
  const monthText = (kind: NonNullable<typeof layout.monthYearMonths>) =>
    kind === "long" ? tables.long[month]
      : kind === "short" ? tables.short[month]
        : kind === "roman" ? (locale.romanMonths ?? ROMAN_MONTHS)[month]
          // The alternate list is Gregorian month names; other calendars keep theirs.
          : kind === "altLong" ? (calendar === Calendar.GREGORIAN || calendar === Calendar.JULIAN || calendar === Calendar.SWEDISH ? locale.altLongMonths?.[month] ?? tables.long[month] : tables.long[month])
            : String(month);
  const values = (kind: NonNullable<typeof layout.monthYearMonths>) => {
    const m = monthText(kind);
    return { day: String(day), month: m, long_month: m, short_month: m, year: y };
  };
  // Inflected month names (long/short lists with forms only).
  const inflected = (form?: string) => {
    if (layout.months !== "long" && layout.months !== "short") return null;
    const short = layout.months === "short";
    return inflectedMonth(month, monthText(layout.months), short ? tables.shortForms : tables.longForms, short, locale, inflect, form);
  };
  if (day === 0) {
    if (month === 0) return layout.yearOnly ? fillTextTemplate(layout.yearOnly, values(layout.months)) : layout.base ? y + locale.yearSuffix : y;
    const inf = inflected(inflect === "" ? layout.monthYearForm : undefined);
    if (inf) return fillTextTemplate(inf.template!, { month: inf.word, year: y });
    return fillTextTemplate(layout.monthYear ?? "{month} {year}", values(layout.monthYearMonths ?? layout.months));
  }
  if (month === 0) {
    // Day set, month not -- gramps bug 8477; ISO unless the layout says.
    return layout.noMonth ? fillTextTemplate(layout.noMonth, values(layout.months)) : displayIso(datePart, locale);
  }
  const inf = inflected(layout.dayForm);
  if (!inf && layout.numericWhenUninflected) return formatNumeric(datePart, locale);
  const v = values(layout.months);
  return fillTextTemplate(layout.template, inf ? { ...v, month: inf.word, long_month: inf.word, short_month: inf.word } : v);
}

/** The layout one date part is drawn with: the language's own for a
 * Gregorian date, Gramps' base ones for every other calendar (see
 * GregorianLayout) -- where a format number past the base list means the
 * base's last one, as `_display_calendar`'s `else` does. */
function layoutFor(calendar: Calendar, locale: DateLocale, index: number): GregorianLayout {
  // Languages whose displayer overrides _display_calendar (Hungarian,
  // Swedish) draw every calendar their own way.
  if (calendar === Calendar.GREGORIAN || locale.layoutsForAllCalendars) return locale.gregorianLayouts[index] ?? BASE_LAYOUTS[0];
  return locale.baseLayouts[Math.min(index, locale.baseLayouts.length - 1)];
}

/** A language's own numeric format (German/French/Dutch/Polish
 * `_display_gregorian`): see GregorianLayout's "numeric". */
function formatLocaleNumeric(datePart: DatePart, locale: DateLocale, layout: Extract<GregorianLayout, { kind: "numeric" }>): string {
  const [day, month, year, slash] = datePart;
  if (slash || (layout.isoWhenBce && year < 0)) return displayIso(datePart, locale);
  let value: string;
  if (day === 0 && month === 0) {
    value = String(layout.absYear ? Math.abs(year) : year);
  } else {
    const two = (n: number) => (layout.pad ? String(n).padStart(2, "0") : String(n));
    value = locale.numericFormat.replace("%e", "%d").replace("%m", two(month));
    if (day === 0 && layout.dropZeroDay) {
      // _date_ja.py: the day and the character after it ("%d日").
      const i = value.indexOf("%d");
      if (i >= 0) value = value.slice(0, i) + value.slice(i + 3);
    }
    value = value.replace("%d", two(day)).replace("%Y", String(layout.absYear ? Math.abs(year) : year));
    if (layout.dashToSlash) value = value.replace(/-/g, "/");
  }
  return formatBce(value, datePart, locale);
}

/** `_display_calendar` / a language's `_display_gregorian`: one date part
 * in the locale's numbered format `index`. */
function displayDatePartAt(datePart: DatePart, calendar: Calendar, locale: DateLocale, index: number, inflect: InflectKey = ""): string {
  const layout = layoutFor(calendar, locale, index);
  switch (layout.kind) {
    case "iso":
      return displayIso(datePart, locale);
    case "baseNumeric":
      return formatBce(locale.numericLstrip ? formatNumeric(datePart, locale).trimStart() : formatNumeric(datePart, locale), datePart, locale);
    case "numeric":
      return formatLocaleNumeric(datePart, locale, layout);
    case "text":
      return formatBce(formatText(datePart, monthTablesFor(calendar, locale), locale, layout, calendar, inflect), datePart, locale);
  }
}

/** One date part in one of this package's six formats. */
export function displayDatePart(
  datePart: DatePart,
  calendar: Calendar,
  locale: DateLocale,
  format: DateFormat
): string {
  return displayDatePartAt(datePart, calendar, locale, locale.formatIndex[format] ?? format);
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(quality|start|stop|date|calendar)\}/g, (_m, key: string) => values[key] ?? "");
}

/** `dd_span` / `dd_range` (or a language's own display() wording for
 * them): "from X to Y", "zwischen X und Y", ... */
function displayCompound(date: GrampsDate, locale: DateLocale, index: number, template: string): string {
  return fillTemplate(template, {
    quality: locale.qualityStrings[date.quality] ?? "",
    start: displayDatePartAt(getStartDate(date), date.calendar, locale, index, date.modifier === Modifier.SPAN ? "from" : "between"),
    stop: displayDatePartAt(getStopDate(date), date.calendar, locale, index, date.modifier === Modifier.SPAN ? "to" : "and"),
    calendar: formatExtras(date.calendar, date.newyear, locale),
  });
}

/**
 * `display_formatted` (== DateDisplayEn.display): the main entry point.
 * "before 1960", "about Nov 1914", "between 1920 and 1930",
 * "from Jan 1914 to Mar 1918", free text, all handled here, per
 * `date.modifier`.
 */
export function formatDate(date: GrampsDate, options: FormatDateOptions = {}): string {
  const locale = resolveLocale(options.locale);
  const format = options.format ?? DateFormat.DAY_SHORT_MONTH_YEAR;
  const index = options.grampsFormat ?? locale.formatIndex[format] ?? format;

  const start = getStartDate(date);
  if (date.modifier === Modifier.TEXTONLY) return date.text;
  if (start[0] === 0 && start[1] === 0 && start[2] === 0) return "";
  if (locale.display) {
    return locale.display(date, {
      locale,
      part: (datePart, calendar) => displayDatePartAt(datePart, calendar, locale, index),
      extras: (calendar, newyear) => formatExtras(calendar, newyear, locale),
    });
  }
  const templates = locale.templates[date.quality] ?? locale.templates[0];
  if (date.modifier === Modifier.SPAN) return displayCompound(date, locale, index, templates.span);
  if (date.modifier === Modifier.RANGE) return displayCompound(date, locale, index, templates.range);

  // The modifier's word (and its position -- Finnish puts it after the
  // date) is part of the template, extracted from Gramps' own output.
  return fillTemplate(templates.modifiers[date.modifier] ?? "{quality}{date}{calendar}", {
    quality: locale.qualityStrings[date.quality] ?? "",
    date: displayDatePartAt(start, date.calendar, locale, index, inflectKey(date)),
    calendar: formatExtras(date.calendar, date.newyear, locale),
  });
}

/** display_formatted's date_type: the context a single date is shown in. */
function inflectKey(date: GrampsDate): InflectKey {
  switch (date.modifier) {
    case Modifier.BEFORE: return "before";
    case Modifier.AFTER: return "after";
    case Modifier.FROM: return "from";
    case Modifier.TO: return "to";
    case Modifier.ABOUT: return "about";
  }
  if (date.quality === Quality.ESTIMATED) return "estimated";
  if (date.quality === Quality.CALCULATED) return "calculated";
  return "";
}
