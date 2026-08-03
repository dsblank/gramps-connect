// Translated from gramps/gen/lib/date.py's Date class -- constants and the
// wire-format Date struct shape (see GrampsDate below), not the class
// itself (Gramps' Date carries a great deal of parsing/arithmetic/
// comparison behavior this package doesn't need; only the shape that
// crosses the wire via gramps-web-api's to_struct() and the constant
// values needed to interpret it).
//
// Original:
//   Gramps - a GTK+/GNOME based genealogy program
//   Copyright (C) 2000-2007       Donald N. Allingham
//   Copyright (C) 2009-2013,2024  Douglas S. Blank
//   Copyright (C) 2013            Paul Franklin
//   Copyright (C) 2013-2014       Vassilii Khachaturov
//   Copyright (C) 2017,2024       Nick Hall
//   Licensed under the GNU General Public License, version 2 or later.
//   https://github.com/gramps-project/gramps/blob/master/gramps/gen/lib/date.py

/** `Date.MOD_*` -- how a date's value(s) should be read: a single point,
 * before/after/about it, a compound span or range of two points, or free
 * text with no structured value at all. */
export enum Modifier {
  NONE = 0,
  BEFORE = 1,
  AFTER = 2,
  ABOUT = 3,
  RANGE = 4,
  SPAN = 5,
  TEXTONLY = 6,
  FROM = 7,
  TO = 8,
}

/** `Date.QUAL_*` -- bitwise, but ESTIMATED|CALCULATED is unused in
 * practice (see date.py's own "unused in source!!" note on QUAL_INTERPRETED). */
export enum Quality {
  NONE = 0,
  ESTIMATED = 1,
  CALCULATED = 2,
}

/** `Date.CAL_*` -- also the index into `_calendar_convert`/`_calendar_change`
 * (see calendar.ts) and into a locale's `calendar` name table. */
export enum Calendar {
  GREGORIAN = 0,
  JULIAN = 1,
  HEBREW = 2,
  FRENCH = 3,
  PERSIAN = 4,
  ISLAMIC = 5,
  SWEDISH = 6,
}

/** `Date.NEWYEAR_*` -- a non-Jan-1 new year start, relevant to a handful of
 * historical calendars/periods; `[month, day]` for a custom start. */
export enum NewYear {
  JAN1 = 0,
  MAR1 = 1,
  MAR25 = 2,
  SEP1 = 3,
}

export type NewYearValue = NewYear | [month: number, day: number];

/** `[day, month, year, slash]` -- Gramps' own dateval convention. `day`/
 * `month` are 0 when unset (a year-only or year-month date); `slash` marks
 * a dual-dated year written as e.g. "1745/6" (Old/New Style, pre-1752
 * British calendar reform). */
export type DatePart = [day: number, month: number, year: number, slash: boolean];

/** The full wire-format Date struct, matching what gramps-web-api's
 * to_struct() serializes and what a `{"json_path": [..., "date"]}` select
 * entry returns. `dateval` is 4 elements for a simple date, 8 for a
 * compound one (RANGE/SPAN) -- elements 4-7 are the second DatePart,
 * Gramps' own `_POS_RDAY.._POS_RSL` layout (see date.py). */
export interface GrampsDate {
  _class?: "Date";
  modifier: Modifier;
  quality: Quality;
  calendar: Calendar;
  dateval: DatePart | [...DatePart, ...DatePart];
  /** Set only for MOD_TEXTONLY, or as a fallback annotation on a
   * structured date; empty string otherwise -- never null/undefined on
   * the wire, per gramps-web-api's own sample responses. */
  text: string;
  newyear: NewYearValue;
  /** Julian Day Number of the (start) date -- present for sort/compare,
   * not used by display/entry in this package. */
  sortval?: number;
  format?: number | null;
}

export const EMPTY_DATE_PART: DatePart = [0, 0, 0, false];

export function isCompound(date: Pick<GrampsDate, "modifier">): boolean {
  return date.modifier === Modifier.RANGE || date.modifier === Modifier.SPAN;
}

/** Mirrors Date.get_start_date(): (0,0,0,false) for MOD_TEXTONLY, else the
 * first 4 dateval elements. */
export function getStartDate(date: GrampsDate): DatePart {
  if (date.modifier === Modifier.TEXTONLY) return EMPTY_DATE_PART;
  return date.dateval.slice(0, 4) as DatePart;
}

/** Mirrors Date.get_stop_date(): only meaningful (and present) for a
 * compound RANGE/SPAN date; (0,0,0,false) otherwise. */
export function getStopDate(date: GrampsDate): DatePart {
  if (!isCompound(date)) return EMPTY_DATE_PART;
  return date.dateval.slice(4, 8) as DatePart;
}
