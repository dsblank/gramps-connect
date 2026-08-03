// Structured date entry: build a well-formed GrampsDate from user-entered
// components, and validate one (e.g. before sending it back to
// gramps-web-api).
//
// validateDate is translated from gramps-web's src/gcalendar.js
// (validateGrampsDate), itself a JS port of the round-trip-SDN validation
// approach gramps/gen/lib/gcalendar.py's own edit-dialog code uses --
// see calendar.ts's header for the original Python copyright/license.
//
// This does *not* attempt to port gramps/gen/datehandler/_dateparser.py
// (free-text date parsing, e.g. typing "before 1960" and having it
// structured automatically) -- that's a large, separate regex-based
// grammar. Structured entry (explicit day/month/year/modifier/quality/
// calendar fields, the same shape Gramps' own "expanded" date editor
// uses) covers date entry without it; text parsing can be added later if
// actually needed.

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
