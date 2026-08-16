// Structured date entry: build a well-formed GrampsDate from user-entered
// components, and validate one (e.g. before sending it back to
// gramps-web-api).
//
// validateDate is translated from gramps-web's src/gcalendar.js
// (validateGrampsDate), itself a JS port of the round-trip-SDN validation
// approach gramps/gen/lib/gcalendar.py's own edit-dialog code uses --
// see calendar.ts's header for the original Python copyright/license.
//
// Free-text date parsing (typing "before 1960" and having it structured
// automatically) lives in parse.ts, a port of
// gramps/gen/datehandler/_dateparser.py -- kept separate from this file's
// explicit-component entry since it's a large, separate regex-based
// grammar built on top of makeDate here, not a replacement for it.
//
// newyearToInputStr/newyearFromInputStr are translated from date.py's
// Date.newyear_to_str/Date.newyear_to_code -- the New Year field's own
// plain value ("Mar25", "3-25"), distinct from display.ts's formatExtras
// which produces the "(Julian, Mar25)" *suffix* string.

import { Calendar, Modifier, NewYear, Quality, type DatePart, type GrampsDate, type NewYearValue } from "./types";
import { dateToSdn, isValidCalendarDate } from "./calendar";

export interface ValidationResult {
  date1Invalid: boolean;
  date2Empty: boolean;
  date2Invalid: boolean;
  date2OrderInvalid: boolean;
  valid: boolean;
}

/**
 * Validate a GrampsDate. Modifiers RANGE and SPAN require a second date in
 * `dateval[4..7]`; for those, the second date must be non-empty,
 * calendar-valid, and strictly later than the first (compared year ->
 * month -> day, with 0 -- "unspecified" -- sorting first).
 */
export function validateDate(date: GrampsDate): ValidationResult {
  const dv = date?.dateval;
  if (!dv) {
    return { date1Invalid: false, date2Empty: false, date2Invalid: false, date2OrderInvalid: false, valid: false };
  }

  const cal = date.calendar ?? Calendar.GREGORIAN;
  const hasSecond = date.modifier === Modifier.RANGE || date.modifier === Modifier.SPAN;
  const [d1, m1, y1] = dv;
  const date1Invalid = (d1 !== 0 || m1 !== 0 || y1 !== 0) && !isValidCalendarDate(cal, y1, m1, d1);

  if (!hasSecond) {
    return {
      date1Invalid,
      date2Empty: false,
      date2Invalid: false,
      date2OrderInvalid: false,
      valid: !date1Invalid && dv.length <= 4,
    };
  }

  if (dv.length < 8) {
    return { date1Invalid, date2Empty: true, date2Invalid: false, date2OrderInvalid: false, valid: false };
  }

  // dv.length >= 8 confirmed above; positions 4-6 (day/month/year of the
  // stop date) are always numbers, only 3/7 (the slash flags) are boolean.
  const [d2, m2, y2] = (dv as readonly number[]).slice(4, 7);
  const date2Empty = d2 === 0 && m2 === 0 && y2 === 0;
  const date2Invalid = !date2Empty && !isValidCalendarDate(cal, y2, m2, d2);
  const date2OrderInvalid =
    !date2Empty && !date2Invalid && (y2 < y1 || (y2 === y1 && (m2 < m1 || (m2 === m1 && d2 <= d1))));

  return {
    date1Invalid,
    date2Empty,
    date2Invalid,
    date2OrderInvalid,
    valid: !date1Invalid && !date2Empty && !date2Invalid && !date2OrderInvalid,
  };
}

export interface DateInput {
  modifier?: Modifier;
  quality?: Quality;
  calendar?: Calendar;
  newyear?: NewYearValue;
  /** [day, month, year, slash] for a simple date, or for the *first* half
   * of a RANGE/SPAN. day/month 0 means unspecified; slash marks a
   * dual-dated year (e.g. 1745/6). */
  start?: [day: number, month: number, year: number, slash?: boolean];
  /** Required (and only meaningful) for RANGE/SPAN -- the second half. */
  stop?: [day: number, month: number, year: number, slash?: boolean];
  /** MOD_TEXTONLY's freeform value, or an annotation carried alongside a
   * structured date (matching the wire format's own `text` field, which
   * is never null). */
  text?: string;
}

const EMPTY: DatePart = [0, 0, 0, false];

/**
 * Build a GrampsDate from structured input, filling in sensible defaults
 * (modifier NONE, quality NONE, calendar GREGORIAN, new year Jan 1) and
 * computing `sortval` from the start date via the matching calendar's SDN
 * conversion. Does not itself validate -- call validateDate() on the
 * result if the input might be malformed (e.g. fresh from a form).
 *
 * `sortval` here approximates Gramps' own: it's always the *start* date's
 * SDN, whereas core Gramps applies a few additional offset rules for
 * RANGE/SPAN sort ordering that aren't replicated -- fine for display and
 * for round-tripping through this package, not guaranteed to sort
 * identically to core Gramps in every compound-date edge case.
 */
function toDatePart(part: DateInput["start"]): DatePart {
  if (!part) return EMPTY;
  const [day, month, year, slash] = part;
  return [day, month, year, slash ?? false];
}

export function makeDate(input: DateInput): GrampsDate {
  const modifier = input.modifier ?? Modifier.NONE;
  const calendar = input.calendar ?? Calendar.GREGORIAN;
  const start = toDatePart(input.start);

  let dateval: GrampsDate["dateval"] = start;
  if (modifier === Modifier.RANGE || modifier === Modifier.SPAN) {
    const stop = toDatePart(input.stop);
    dateval = [...start, ...stop] as [...DatePart, ...DatePart];
  }

  const isEmptyStart = start[0] === 0 && start[1] === 0 && start[2] === 0;
  const sortval =
    modifier === Modifier.TEXTONLY || isEmptyStart
      ? 0
      : dateToSdn(calendar, start[2], start[1], start[0]);

  return {
    _class: "Date",
    modifier,
    quality: input.quality ?? Quality.NONE,
    calendar,
    dateval,
    text: input.text ?? "",
    newyear: input.newyear ?? NewYear.JAN1,
    sortval,
  };
}

export function emptyDate(): GrampsDate {
  return makeDate({});
}

/** The New Year field's own displayed value: "" for the default (Jan 1),
 * "Mar1"/"Mar25"/"Sep1" for the other three named starts, or "M-D" for a
 * custom one. Mirrors Date.newyear_to_str(). */
export function newyearToInputStr(value: NewYearValue): string {
  if (Array.isArray(value)) return `${value[0]}-${value[1]}`;
  switch (value) {
    case NewYear.JAN1: return "";
    case NewYear.MAR1: return "Mar1";
    case NewYear.MAR25: return "Mar25";
    case NewYear.SEP1: return "Sep1";
    default: return "Err";
  }
}

/** Parse the New Year field's own value back into a NewYearValue -- "",
 * "jan1", "mar1", "mar25", "sep1" (case-insensitive), or "M-D" for a
 * custom start. Anything else (including a malformed "M-D") falls back to
 * Jan 1, matching Date.newyear_to_code()'s own `code = 0` fallback. */
export function newyearFromInputStr(input: string): NewYearValue {
  const s = input.trim().toLowerCase();
  if (s === "" || s === "jan1") return NewYear.JAN1;
  if (s === "mar1") return NewYear.MAR1;
  if (s === "mar25") return NewYear.MAR25;
  if (s === "sep1") return NewYear.SEP1;
  if (s.includes("-")) {
    const parts = s.split("-").map(Number);
    if (parts.length === 2 && parts.every((n) => Number.isInteger(n))) {
      return [parts[0], parts[1]];
    }
    return NewYear.JAN1;
  }
  return NewYear.JAN1;
}
