// Calendar SDN (Serial Day Number) conversion, and date-entry validation
// built on top of it.
//
// Translated from gramps/gen/lib/gcalendar.py, for the five "simpler"
// calendars: Gregorian, Julian, French Republican, Islamic, and Swedish.
// Hebrew and Persian need more involved helper functions and aren't
// covered here -- gramps-web's own JS port of the same module
// (src/gcalendar.js) carries the identical scope note, for the same
// reason; see isValidCalendarDate's docstring.
//
// The SDN is identical to the Julian Day Number (JDN). All functions
// accept and return integer values. Year numbering uses astronomical
// convention: year 0 = 1 BC, year -1 = 2 BC, etc.
//
// Original:
//   Gramps - a GTK+/GNOME based genealogy program
//   Copyright (C) 2000-2006  Donald N. Allingham
//   Licensed under the GNU General Public License, version 2 or later.
//   https://github.com/gramps-project/gramps/blob/master/gramps/gen/lib/gcalendar.py

import { Calendar } from "./types";

const GRG_SDN_OFFSET = 32045;
const GRG_DAYS_PER_5_MONTHS = 153;
const GRG_DAYS_PER_4_YEARS = 1461;
const GRG_DAYS_PER_400_YEARS = 146097;

/** Convert a Gregorian (year, month, day) to an SDN. */
export function gregorianSdn(year: number, month: number, day: number): number {
  let y = year < 0 ? year + 4801 : year + 4800;
  let m = month;
  if (m > 2) {
    m -= 3;
  } else {
    m += 9;
    y -= 1;
  }
  return (
    Math.floor((Math.floor(y / 100) * GRG_DAYS_PER_400_YEARS) / 4) +
    Math.floor(((y % 100) * GRG_DAYS_PER_4_YEARS) / 4) +
    Math.floor((m * GRG_DAYS_PER_5_MONTHS + 2) / 5) +
    day -
    GRG_SDN_OFFSET
  );
}

/** Convert an SDN to a Gregorian [year, month, day]. */
export function gregorianYmd(sdn: number): [number, number, number] {
  let temp = (GRG_SDN_OFFSET + sdn) * 4 - 1;
  const century = Math.floor(temp / GRG_DAYS_PER_400_YEARS);
  temp = Math.floor((temp % GRG_DAYS_PER_400_YEARS) / 4) * 4 + 3;
  let year = century * 100 + Math.floor(temp / GRG_DAYS_PER_4_YEARS);
  const dayOfYear = Math.floor((temp % GRG_DAYS_PER_4_YEARS) / 4) + 1;
  temp = dayOfYear * 5 - 3;
  let month = Math.floor(temp / GRG_DAYS_PER_5_MONTHS);
  const day = Math.floor((temp % GRG_DAYS_PER_5_MONTHS) / 5) + 1;
  if (month < 10) {
    month += 3;
  } else {
    year += 1;
    month -= 9;
  }
  year -= 4800;
  // year 0 is not a valid Gramps year; dateval year 0 means "unspecified".
  // 1 BC = year -1.
  if (year <= 0) year -= 1;
  return [year, month, day];
}

const JLN_SDN_OFFSET = 32083;
const JLN_DAYS_PER_5_MONTHS = 153;
const JLN_DAYS_PER_4_YEARS = 1461;

/** Convert a Julian calendar (year, month, day) to an SDN. */
export function julianSdn(year: number, month: number, day: number): number {
  let y = year < 0 ? year + 4801 : year + 4800;
  let m = month;
  if (m > 2) {
    m -= 3;
  } else {
    m += 9;
    y -= 1;
  }
  return (
    Math.floor((y * JLN_DAYS_PER_4_YEARS) / 4) +
    Math.floor((m * JLN_DAYS_PER_5_MONTHS + 2) / 5) +
    day -
    JLN_SDN_OFFSET
  );
}

/** Convert an SDN to a Julian calendar [year, month, day]. */
export function julianYmd(sdn: number): [number, number, number] {
  const temp = (sdn + JLN_SDN_OFFSET) * 4 - 1;
  let year = Math.floor(temp / JLN_DAYS_PER_4_YEARS);
  const dayOfYear = Math.floor((temp % JLN_DAYS_PER_4_YEARS) / 4) + 1;
  const temp2 = dayOfYear * 5 - 3;
  let month = Math.floor(temp2 / JLN_DAYS_PER_5_MONTHS);
  const day = Math.floor((temp2 % JLN_DAYS_PER_5_MONTHS) / 5) + 1;
  if (month < 10) {
    month += 3;
  } else {
    year += 1;
    month -= 9;
  }
  year -= 4800;
  if (year <= 0) year -= 1;
  return [year, month, day];
}

const FR_SDN_OFFSET = 2375474;
const FR_DAYS_PER_4_YEARS = 1461;
const FR_DAYS_PER_MONTH = 30;

/** Convert a French Republican calendar (year, month, day) to an SDN. */
export function frenchSdn(year: number, month: number, day: number): number {
  return (
    Math.floor((year * FR_DAYS_PER_4_YEARS) / 4) +
    (month - 1) * FR_DAYS_PER_MONTH +
    day +
    FR_SDN_OFFSET
  );
}

/** Convert an SDN to a French Republican calendar [year, month, day]. */
export function frenchYmd(sdn: number): [number, number, number] {
  const temp = (sdn - FR_SDN_OFFSET) * 4 - 1;
  const year = Math.floor(temp / FR_DAYS_PER_4_YEARS);
  const dayOfYear = Math.floor((temp % FR_DAYS_PER_4_YEARS) / 4);
  const month = Math.floor(dayOfYear / FR_DAYS_PER_MONTH) + 1;
  const day = (dayOfYear % FR_DAYS_PER_MONTH) + 1;
  return [year, month, day];
}

const ISM_EPOCH = 1948439.5;

/** Convert an Islamic calendar (year, month, day) to an SDN. */
export function islamicSdn(year: number, month: number, day: number): number {
  return Math.ceil(
    day +
      Math.ceil(29.5 * (month - 1)) +
      (year - 1) * 354 +
      Math.floor((3 + 11 * year) / 30) +
      ISM_EPOCH -
      1
  );
}

/** Convert an SDN to an Islamic calendar [year, month, day]. */
export function islamicYmd(sdn: number): [number, number, number] {
  const s = Math.floor(sdn) + 0.5;
  const year = Math.floor((30 * (s - ISM_EPOCH) + 10646) / 10631);
  const month = Math.min(12, Math.ceil((s - (29 + islamicSdn(year, 1, 1))) / 29.5) + 1);
  const day = Math.floor(s - islamicSdn(year, month, 1)) + 1;
  return [year, month, day];
}

/** Swedish calendar: Julian minus 1 day from 1700-03-01 through
 * 1712-02-29 (a unique leap day), then Julian again until 1753-02-28,
 * and Gregorian from 1753-03-01 onwards. */
function dateCmp(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

export function swedishSdn(year: number, month: number, day: number): number {
  const d: [number, number, number] = [year, month, day];
  if (dateCmp(d, [1700, 3, 1]) >= 0 && dateCmp(d, [1712, 2, 30]) <= 0) {
    return julianSdn(year, month, day) - 1;
  }
  if (dateCmp(d, [1753, 3, 1]) >= 0) return gregorianSdn(year, month, day);
  return julianSdn(year, month, day);
}

/** Convert an SDN to a Swedish calendar [year, month, day]. */
export function swedishYmd(sdn: number): [number, number, number] {
  if (sdn === 2346425) return [1712, 2, 30]; // unique Swedish leap day
  if (sdn >= 2342042 && sdn < 2346425) return julianYmd(sdn + 1);
  if (sdn >= 2361390) return gregorianYmd(sdn);
  return julianYmd(sdn);
}

/** Convert any of the five supported calendars' (year, month, day) to an
 * SDN. Zero-adjusts partial dates (year/month/day unset -> 1) so a
 * partial date still round-trips through a real SDN for validation
 * purposes -- see isValidCalendarDate. */
export function dateToSdn(calendar: Calendar, year: number, month: number, day: number): number {
  if (year === 0 && month === 0 && day === 0) return 0;
  const y = year !== 0 ? year : 1;
  const m = month > 0 ? month : 1;
  const d = day > 0 ? day : 1;
  switch (calendar) {
    case Calendar.GREGORIAN:
      return gregorianSdn(y, m, d);
    case Calendar.JULIAN:
      return julianSdn(y, m, d);
    case Calendar.FRENCH:
      return frenchSdn(y, m, d);
    case Calendar.ISLAMIC:
      return islamicSdn(y, m, d);
    case Calendar.SWEDISH:
      return swedishSdn(y, m, d);
    default:
      throw new Error(`Calendar ${calendar} not implemented`);
  }
}

/**
 * Is (year, month, day) a valid date in the given calendar?
 *
 * Partial dates (month === 0 or day === 0) are always accepted -- they
 * mean "unspecified" in Gramps. When year === 0 (unspecified), a
 * canonical Gregorian leap year (4 AD) stands in, so Feb 29 is accepted
 * as a valid day-of-month regardless of the actual year.
 *
 * Hebrew and Persian (Calendar.HEBREW / Calendar.PERSIAN) always return
 * true: this port, like gramps-web's, doesn't implement their SDN
 * conversion, so there's nothing to validate against.
 *
 * Uses the round-trip SDN method: convert to an SDN and back; valid iff
 * the result equals the input.
 */
export function isValidCalendarDate(
  calendar: Calendar,
  year: number,
  month: number,
  day: number
): boolean {
  if (month === 0 || day === 0) return true;
  if (calendar === Calendar.HEBREW || calendar === Calendar.PERSIAN) return true;

  const y = year !== 0 ? year : 4;
  let roundTrip: [number, number, number];
  switch (calendar) {
    case Calendar.GREGORIAN:
      roundTrip = gregorianYmd(gregorianSdn(y, month, day));
      break;
    case Calendar.JULIAN:
      roundTrip = julianYmd(julianSdn(y, month, day));
      break;
    case Calendar.FRENCH:
      roundTrip = frenchYmd(frenchSdn(y, month, day));
      break;
    case Calendar.ISLAMIC:
      roundTrip = islamicYmd(islamicSdn(y, month, day));
      break;
    case Calendar.SWEDISH:
      roundTrip = swedishYmd(swedishSdn(y, month, day));
      break;
    default:
      return true;
  }
  return roundTrip[1] === month && roundTrip[2] === day && (year === 0 || roundTrip[0] === y);
}
