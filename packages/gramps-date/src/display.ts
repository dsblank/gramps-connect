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

import { Calendar, Modifier, NewYearValue, type DatePart, type GrampsDate, getStartDate, getStopDate } from "./types";
import { type DateLocale, getLocale } from "./locale";
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

function formatNumeric(datePart: DatePart, locale: DateLocale): string {
  const [day, month, year, slash] = datePart;
  if (slash) return displayIso(datePart, locale);
  // Year only: str(year) in dd_dformat01 -- signed, so a BCE year shows as
  // "-44 B.C.E." (Gramps' own output, quirk included).
  if (day === 0 && month === 0) return String(year);

  let value = locale.numericFormat.replace("%m", String(month));
  if (day === 0) {
    // Remove the zero day and its adjacent delimiter -- mirrors
    // dd_dformat01's exact index arithmetic for "which side is the
    // delimiter on."
    const i = value.indexOf("%d");
    if (value.length === i + 2) {
      value = value.slice(0, i - 1) + value.slice(i + 2); // delimiter to the left
    } else {
      value = value.slice(0, i) + value.slice(i + 3); // delimiter to the right
    }
  }
  value = value.replace("%d", String(day));
  value = value.replace("%Y", String(Math.abs(year)));
  return value.replace(/-/g, "/");
}

function monthTablesFor(calendar: Calendar, locale: DateLocale): { long: readonly string[]; short: readonly string[] } {
  // Only Gregorian/Julian/Swedish (which display identically -- see
  // _display_julian = _display_swedish = _display_gregorian in the
  // original) have distinct long/short month tables; the other
  // calendars have no abbreviated form in Gramps at all.
  switch (calendar) {
    case Calendar.HEBREW:
      return { long: locale.hebrewMonths, short: locale.hebrewMonths };
    case Calendar.FRENCH:
      return { long: locale.frenchMonths, short: locale.frenchMonths };
    case Calendar.ISLAMIC:
      return { long: locale.islamicMonths, short: locale.islamicMonths };
    case Calendar.PERSIAN:
      return { long: locale.persianMonths, short: locale.persianMonths };
    default:
      return { long: locale.longMonths, short: locale.shortMonths };
  }
}

function monthDayYear(datePart: DatePart, months: readonly string[], locale: DateLocale, dayFirst: boolean, dayDot = false): string {
  const [day, month, year, slash] = datePart;
  const y = slashYear(year, slash);
  if (day === 0) {
    if (month === 0) return y;
    return `${months[month]} ${y}`;
  }
  if (month === 0) return displayIso(datePart, locale); // day set, month not -- gramps bug 8477
  return dayFirst ? `${day}${dayDot ? "." : ""} ${months[month]} ${y}` : `${months[month]} ${day}, ${y}`;
}

/** The layout one date part is drawn with: the language's own for a
 * Gregorian date, Gramps' base ones for every other calendar (see
 * GregorianLayout) -- where a format number past the base list means the
 * base's last one, as `_display_calendar`'s `else` does. */
function layoutFor(calendar: Calendar, locale: DateLocale, index: number): GregorianLayout {
  if (calendar === Calendar.GREGORIAN) return locale.gregorianLayouts[index] ?? BASE_LAYOUTS[0];
  return BASE_LAYOUTS[Math.min(index, BASE_LAYOUTS.length - 1)];
}

/** A language's own numeric format (German/French `_display_gregorian`
 * formats 1 and 6/8): the pattern filled in as-is, with the raw signed
 * year and any zero day kept. */
function formatLocaleNumeric(datePart: DatePart, locale: DateLocale, pad: boolean, isoWhenBce: boolean): string {
  const [day, month, year, slash] = datePart;
  if (slash || (isoWhenBce && year < 0)) return displayIso(datePart, locale);
  let value: string;
  if (day === 0 && month === 0) {
    value = String(year);
  } else {
    const two = (n: number) => (pad ? String(n).padStart(2, "0") : String(n));
    value = locale.numericFormat.replace("%m", two(month)).replace("%d", two(day)).replace("%Y", String(year));
  }
  return formatBce(value, datePart, locale);
}

/** `_display_calendar` / a language's `_display_gregorian`: one date part
 * in the locale's numbered format `index`. */
function displayDatePartAt(datePart: DatePart, calendar: Calendar, locale: DateLocale, index: number): string {
  const layout = layoutFor(calendar, locale, index);
  switch (layout.kind) {
    case "iso":
      return displayIso(datePart, locale);
    case "baseNumeric":
      return formatBce(formatNumeric(datePart, locale), datePart, locale);
    case "numeric":
      return formatLocaleNumeric(datePart, locale, layout.pad, layout.isoWhenBce);
    case "text": {
      const tables = monthTablesFor(calendar, locale);
      const months = layout.months === "long" ? tables.long : tables.short;
      return formatBce(monthDayYear(datePart, months, locale, layout.order === "dmy", layout.dayDot), datePart, locale);
    }
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
    start: displayDatePartAt(getStartDate(date), date.calendar, locale, index),
    stop: displayDatePartAt(getStopDate(date), date.calendar, locale, index),
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
  if (date.modifier === Modifier.SPAN) return displayCompound(date, locale, index, locale.templates.span);
  if (date.modifier === Modifier.RANGE) return displayCompound(date, locale, index, locale.templates.range);

  // The modifier's word (and its position -- Finnish puts it after the
  // date) is part of the template, extracted from Gramps' own output.
  return fillTemplate(locale.templates.modifiers[date.modifier] ?? "{quality}{date}{calendar}", {
    quality: locale.qualityStrings[date.quality] ?? "",
    date: displayDatePartAt(start, date.calendar, locale, index),
    calendar: formatExtras(date.calendar, date.newyear, locale),
  });
}
