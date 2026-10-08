// Date layouts -- in their own module (no imports) so locale files can
// use them without a cycle through locale.ts's registry.

/** How a language lays out a date in one of its numbered formats -- the
 * shapes Gramps' displayers use. A language's own layouts (its
 * `_display_gregorian`, gen/datehandler/_date_*.py) apply to Gregorian
 * dates; every other calendar, Julian and Swedish included, uses the
 * language's *base* layouts (`_display_calendar`): a `_display_gregorian`
 * override doesn't reach them, because the base class binds
 * `_display_julian = _display_swedish` to its own method. */
export type GregorianLayout =
  /** YYYY-MM-DD (`display_iso`). */
  | { kind: "iso" }
  /** The base class's numeric format (`dd_dformat01`): the language's
   * numeric pattern, a zero day dropped along with its delimiter ("3/1854"),
   * %b/%B as the month *number*, %a/%A as the weekday. */
  | { kind: "baseNumeric" }
  /** A language's own numeric format, as German/French/Dutch/Polish write
   * it: the `numericFormat` pattern filled in as-is, zero day kept
   * ("0.3.1854"), optionally zero-padded; the year signed, or unsigned with
   * `absYear`; "-" made "/" with `dashToSlash` (Dutch); slash (dual) years
   * shown as ISO, and BCE too when `isoWhenBce`. */
  | {
      kind: "numeric";
      pad: boolean;
      isoWhenBce: boolean;
      absYear?: boolean;
      dashToSlash?: boolean;
      /** Drop a zero day and the delimiter after it (Japanese
       * "1789年11月"), instead of keeping it. */
      dropZeroDay?: boolean;
    }
  /** A format built from a template, in Python str.format syntax with
   * {day} (or {day:d}), {month} (also {long_month} / {short_month}),
   * {year} -- Gramps' base ones are translated per language
   * ("{day:d} {long_month} {year}"), a language's own are its literal
   * patterns ("{day}. {month} {year}", Greek "{day}-{month}-{year}"). The
   * month is its long or short name, a Roman numeral (Polish) or the
   * number (Greek, Polish). A date without a day uses `monthYear` (default
   * "{month} {year}"); without a month, just the year (`base`: through
   * _get_localized_year, e.g. Croatian's "1854."). */
  | {
      kind: "text";
      months: "long" | "short" | "roman" | "number";
      template: string;
      monthYear?: string;
      /** The month-and-year form's month list, when it differs
       * (Lithuanian's nominative "altLong"). */
      monthYearMonths?: "long" | "short" | "roman" | "number" | "altLong";
      /** A bare year (default "{year}", Serbian "{year}."). */
      yearOnly?: string;
      /** A day without a month (default: ISO; Hungarian "{year}. - {day:02d}."). */
      noMonth?: string;
      /** Dual-dated (slash) years shown as ISO (Hungarian numeric). */
      isoWhenSlash?: boolean;
      /** Inflected month names (DateLocale.inflection): the form a month
       * takes beside a day, whatever the context (Russian genitive "Р",
       * Finnish partitive "P") -- else the context's own form. */
      dayForm?: string;
      /** The form for a month and year with no modifier (Finnish
       * inessive "IN") -- else the context's own. */
      monthYearForm?: string;
      /** A month list without forms shows day dates numerically
       * (DateDisplayFI.dd_dformat04). */
      numericWhenUninflected?: boolean;
      base: boolean;
    };

/** Gramps' base text templates, translated per language (dd_dformat02..05)
 * -- these are the English originals. */
export interface BaseTextTemplates {
  longMonthDayYear: string;
  shortMonthDayYear: string;
  dayLongMonthYear: string;
  dayShortMonthYear: string;
}

export const ENGLISH_BASE_TEXT_TEMPLATES: BaseTextTemplates = {
  longMonthDayYear: "{long_month} {day:d}, {year}",
  shortMonthDayYear: "{short_month} {day:d}, {year}",
  dayLongMonthYear: "{day:d} {long_month} {year}",
  dayShortMonthYear: "{day:d} {short_month} {year}",
};

/** Gramps' base format list for a language with these (translated)
 * templates -- also every language's layout for non-Gregorian calendars. */
export function baseLayouts(templates: BaseTextTemplates): GregorianLayout[] {
  return [
    { kind: "iso" },
    { kind: "baseNumeric" },
    { kind: "text", months: "long", template: templates.longMonthDayYear, base: true },
    { kind: "text", months: "short", template: templates.shortMonthDayYear, base: true },
    { kind: "text", months: "long", template: templates.dayLongMonthYear, base: true },
    { kind: "text", months: "short", template: templates.dayShortMonthYear, base: true },
  ];
}

/** English's base layouts. */
export const BASE_LAYOUTS: readonly GregorianLayout[] = baseLayouts(ENGLISH_BASE_TEXT_TEMPLATES);
