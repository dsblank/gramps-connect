// Date layouts -- in their own module (no imports) so locale files can
// use them without a cycle through locale.ts's registry.

/** How a language lays out a *Gregorian* date in one of its numbered
 * formats -- the shapes its `_display_gregorian` uses (see
 * gen/datehandler/_date_*.py). Every other calendar, Julian and Swedish
 * included, always uses Gramps' base layouts (`_display_calendar`): a
 * language's `_display_gregorian` override doesn't reach them, because the
 * base class binds `_display_julian = _display_swedish` to its *own*
 * method. */
export type GregorianLayout =
  /** YYYY-MM-DD (`display_iso`). */
  | { kind: "iso" }
  /** The base class's numeric format (`dd_dformat01`): drops a zero day
   * along with its delimiter ("3/1854"). */
  | { kind: "baseNumeric" }
  /** A language's own numeric format, as German/French write it: the
   * `numericFormat` pattern filled in as-is, zero day kept ("0.3.1854"),
   * raw (signed) year, optionally zero-padded; slash (dual) years shown
   * as ISO, and BCE too when `isoWhenBce`. */
  | { kind: "numeric"; pad: boolean; isoWhenBce: boolean }
  /** Month-name formats: day-month-year or month-day-year, long or short
   * month names, "12." when `dayDot`. Month-day-year writes
   * "Month 12, 1854". */
  | { kind: "text"; order: "dmy" | "mdy"; months: "long" | "short"; dayDot: boolean };

/** Gramps' base (English) format list, which also serves as every
 * language's layout for non-Gregorian calendars. */
export const BASE_LAYOUTS: readonly GregorianLayout[] = [
  { kind: "iso" },
  { kind: "baseNumeric" },
  { kind: "text", order: "mdy", months: "long", dayDot: false },
  { kind: "text", order: "mdy", months: "short", dayDot: false },
  { kind: "text", order: "dmy", months: "long", dayDot: false },
  { kind: "text", order: "dmy", months: "short", dayDot: false },
];

