// English date-display strings.
//
// Translated from gramps/gen/datehandler/_datestrings.py (string tables)
// and _datedisplay.py (the "" Gregorian-name-suppressed-in-display
// convention, the B.C.E. format, and DateDisplay's en_GB numeric-format
// fallback).
//
// Original:
//   Gramps - a GTK+/GNOME based genealogy program
//   Copyright (C) 2013  Vassilii Khachaturov  (_datestrings.py)
//   Copyright (C) 2004-2006  Donald N. Allingham
//   Copyright (C) 2013       Vassilii Khachaturov
//   Copyright (C) 2014-2018  Paul Franklin      (_datedisplay.py)
//   Licensed under the GNU General Public License, version 2 or later.
//   https://github.com/gramps-project/gramps/tree/master/gramps/gen/datehandler

import type { DateLocale } from "../locale";

export const en: DateLocale = {
  code: "en",

  longMonths: [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],
  shortMonths: [
    "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ],

  hebrewMonths: [
    "", "Tishri", "Heshvan", "Kislev", "Tevet", "Shevat", "AdarI", "AdarII",
    "Nisan", "Iyyar", "Sivan", "Tammuz", "Av", "Elul",
  ],
  frenchMonths: [
    "", "Vendémiaire", "Brumaire", "Frimaire", "Nivôse", "Pluviôse", "Ventôse",
    "Germinal", "Floréal", "Prairial", "Messidor", "Thermidor", "Fructidor", "Extra",
  ],
  islamicMonths: [
    "", "Muharram", "Safar", "Rabi`al-Awwal", "Rabi`ath-Thani", "Jumada l-Ula",
    "Jumada t-Tania", "Rajab", "Sha`ban", "Ramadan", "Shawwal", "Dhu l-Qa`da", "Dhu l-Hijja",
  ],
  persianMonths: [
    "", "Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar",
    "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand",
  ],

  longDays: ["", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  shortDays: ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],

  // Gregorian's own slot is "" -- that name is only used for *parsing*,
  // never shown in display (see _datedisplay.py's __init__: "gregorian
  // cal name shouldn't be output!").
  calendarNames: ["", "Julian", "Hebrew", "French Republican", "Persian", "Islamic", "Swedish"],

  // Indices: NONE, BEFORE, AFTER, ABOUT, RANGE, SPAN, TEXTONLY, FROM, TO.
  // RANGE/SPAN/TEXTONLY are "" here because display.ts formats those
  // compound/text cases through their own dedicated paths (displayRange/
  // displaySpan/date.text), never through this simple prefix table.
  modifierStrings: ["", "before ", "after ", "about ", "", "", "", "from ", "to "],

  qualityStrings: ["", "estimated ", "calculated "],

  // Simplification: real Gramps distinguishes e.g. en_US ("%m/%d/%Y")
  // from en_GB ("%d/%m/%Y") numeric formats via a full locale_tformat
  // table; this package has one "en" locale, using the more common
  // US-style month/day/year ordering.
  numericFormat: "%m/%d/%Y",

  bceFormat: "%s B.C.E.",
};
