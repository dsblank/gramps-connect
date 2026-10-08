// Calendar SDN (Serial Day Number) conversion, and date-entry validation
// built on top of it.
//
// Translated from gramps/gen/lib/gcalendar.py: all seven Gramps calendars
// to an SDN; back from one for Gregorian, Julian, French Republican,
// Islamic and Swedish (validation round-trips through those).
// gramps-web's JS port of the same module (src/gcalendar.js) stops at
// those five.
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


// -- Hebrew and Persian: ports of gen/lib/gcalendar.py's hebrew_sdn (with
// its molad/Tishri helpers) and persian_sdn. Python's // and % floor toward
// negative infinity, hence pyDiv/pyMod.

function pyDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

function pyMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

const HBR_HALAKIM_PER_HOUR = 1080;
const HBR_HALAKIM_PER_DAY = 25920;
const HBR_HALAKIM_PER_LUNAR_CYCLE = 29 * HBR_HALAKIM_PER_DAY + 13753;
const HBR_HALAKIM_PER_METONIC_CYCLE = HBR_HALAKIM_PER_LUNAR_CYCLE * (12 * 19 + 7);
const HBR_SDN_OFFSET = 347997;
const HBR_NEW_MOON_OF_CREATION = 31524;
const HBR_NOON = 18 * HBR_HALAKIM_PER_HOUR;
const HBR_AM3_11_20 = 9 * HBR_HALAKIM_PER_HOUR + 204;
const HBR_AM9_32_43 = 15 * HBR_HALAKIM_PER_HOUR + 589;
const HBR_SUNDAY = 0;
const HBR_MONDAY = 1;
const HBR_TUESDAY = 2;
const HBR_WEDNESDAY = 3;
const HBR_FRIDAY = 5;
const HBR_MONTHS_PER_YEAR = [12, 12, 13, 12, 12, 13, 12, 13, 12, 12, 13, 12, 12, 13, 12, 12, 13, 12, 13];
const HBR_YEAR_OFFSET = [0, 12, 24, 37, 49, 61, 74, 86, 99, 111, 123, 136, 148, 160, 173, 185, 197, 210, 222];

function tishri1(metonicYear: number, moladDay: number, moladHalakim: number): number {
  let day = moladDay;
  let dow = day % 7;
  const leapYear = [2, 5, 7, 10, 13, 16, 18].includes(metonicYear);
  const lastWasLeapYear = [3, 6, 8, 11, 14, 17, 0].includes(metonicYear);
  if (
    moladHalakim >= HBR_NOON ||
    (!leapYear && dow === HBR_TUESDAY && moladHalakim >= HBR_AM3_11_20) ||
    (lastWasLeapYear && dow === HBR_MONDAY && moladHalakim >= HBR_AM9_32_43)
  ) {
    day += 1;
    dow += 1;
    if (dow === 7) dow = 0;
  }
  if (dow === HBR_WEDNESDAY || dow === HBR_FRIDAY || dow === HBR_SUNDAY) day += 1;
  return day;
}

function moladOfMetonicCycle(metonicCycle: number): [number, number] {
  // Same 16-bit-split arithmetic as the original (values stay < 2^31).
  let r1 = HBR_NEW_MOON_OF_CREATION;
  r1 = r1 + metonicCycle * (HBR_HALAKIM_PER_METONIC_CYCLE & 0xffff);
  let r2 = Math.floor(r1 / 65536);
  r2 = r2 + metonicCycle * (Math.floor(HBR_HALAKIM_PER_METONIC_CYCLE / 65536) & 0xffff);
  const d2 = pyDiv(r2, HBR_HALAKIM_PER_DAY);
  r2 -= d2 * HBR_HALAKIM_PER_DAY;
  r1 = (r2 << 16) | (r1 & 0xffff);
  const d1 = pyDiv(r1, HBR_HALAKIM_PER_DAY);
  r1 -= d1 * HBR_HALAKIM_PER_DAY;
  return [(d2 << 16) | d1, r1];
}

function startOfYear(year: number): { metonicYear: number; moladDay: number; moladHalakim: number; tishri1: number } {
  const metonicCycle = pyDiv(year - 1, 19);
  const metonicYear = pyMod(year - 1, 19);
  let [moladDay, moladHalakim] = moladOfMetonicCycle(metonicCycle);
  moladHalakim = moladHalakim + HBR_HALAKIM_PER_LUNAR_CYCLE * HBR_YEAR_OFFSET[metonicYear];
  moladDay = moladDay + pyDiv(moladHalakim, HBR_HALAKIM_PER_DAY);
  moladHalakim = pyMod(moladHalakim, HBR_HALAKIM_PER_DAY);
  return { metonicYear, moladDay, moladHalakim, tishri1: tishri1(metonicYear, moladDay, moladHalakim) };
}

/** hebrew_sdn: months 1 (Tishri) .. 13 (Elul), 6/7 = Adar I/II. */
export function hebrewSdn(year: number, month: number, day: number): number {
  let sdn: number;
  if (month === 1 || month === 2) {
    const start = startOfYear(year);
    sdn = month === 1 ? start.tishri1 + day - 1 : start.tishri1 + day + 29;
  } else if (month === 3) {
    const start = startOfYear(year);
    let moladHalakim = start.moladHalakim + HBR_HALAKIM_PER_LUNAR_CYCLE * HBR_MONTHS_PER_YEAR[start.metonicYear];
    const moladDay = start.moladDay + pyDiv(moladHalakim, HBR_HALAKIM_PER_DAY);
    moladHalakim = pyMod(moladHalakim, HBR_HALAKIM_PER_DAY);
    const after = tishri1(pyMod(start.metonicYear + 1, 19), moladDay, moladHalakim);
    const yearLength = after - start.tishri1;
    sdn = yearLength === 355 || yearLength === 385 ? start.tishri1 + day + 59 : start.tishri1 + day + 58;
  } else if (month === 4 || month === 5 || month === 6) {
    const after = startOfYear(year + 1).tishri1;
    const adarLength = HBR_MONTHS_PER_YEAR[pyMod(year - 1, 19)] === 12 ? 29 : 59;
    sdn = after + day - adarLength - (month === 4 ? 237 : month === 5 ? 208 : 178);
  } else {
    const after = startOfYear(year + 1).tishri1;
    const offsets: Record<number, number> = { 7: 207, 8: 178, 9: 148, 10: 119, 11: 89, 12: 60, 13: 30 };
    if (!(month in offsets)) return 0;
    sdn = after + day - offsets[month];
  }
  return sdn + HBR_SDN_OFFSET;
}

const PRS_EPOCH = 1948320.5;

/** persian_sdn. */
export function persianSdn(year: number, month: number, day: number): number {
  const epbase = year >= 0 ? year - 474 : year - 473;
  const epyear = 474 + pyMod(epbase, 2820);
  const v1 = month <= 7 ? (month - 1) * 31 : (month - 1) * 30 + 6;
  const v2 = pyDiv(epyear * 682 - 110, 2816);
  const v3 = (epyear - 1) * 365 + day;
  const v4 = pyDiv(epbase, 2820) * 1029983;
  return Math.trunc(Math.ceil(v1 + v2 + v3 + v4 + PRS_EPOCH - 1));
}

/** Convert (year, month, day) to an SDN, for any of the seven Gramps
 * calendars. Zero-adjusts partial dates (year/month/day unset -> 1) so a
 * partial date still round-trips through a real SDN for validation
 * purposes -- see isValidCalendarDate. (gramps-web-api also recomputes
 * `sortval` from `dateval` on every write -- recalc_date_sortvals in its
 * api/util.py.) */
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
    case Calendar.HEBREW:
      return hebrewSdn(y, m, d);
    case Calendar.PERSIAN:
      return persianSdn(y, m, d);
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
 * true, as in Gramps: its parser has no validity check for them either
 * (_parse_hebrew/_parse_persian pass check=None).
 *
 * Uses the round-trip SDN method: convert to an SDN and back; valid iff
 * the result equals the input.
 */
const MAX_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const LEAP_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** _dateparser.py's julian_valid: every fourth year is a leap year. */
function julianValid(year: number, month: number, day: number): boolean {
  if (month > 12) return false;
  return day <= (year % 4 === 0 ? LEAP_DAYS : MAX_DAYS)[month - 1];
}

/** _dateparser.py's swedish_valid: the Swedish calendar only existed from
 * 1700-03-01 to 1712-02-30 (its extra day), skipping 1700's leap day. */
function swedishValid(year: number, month: number, day: number): boolean {
  const key = year * 10000 + month * 100 + day;
  if (key < 17000229 || key >= 17120301) return false;
  if (key === 17120230) return true;
  if (!julianValid(year, month, day)) return false;
  return key !== 17000229;
}

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
      return swedishValid(year, month, day);
    default:
      return true;
  }
  return roundTrip[1] === month && roundTrip[2] === day && (year === 0 || roundTrip[0] === y);
}
