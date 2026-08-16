// English date-display *and* date-parsing strings.
//
// Translated from gramps/gen/datehandler/_datestrings.py (string tables),
// _datedisplay.py (the "" Gregorian-name-suppressed-in-display convention,
// the B.C.E. format, and DateDisplay's en_GB numeric-format fallback), and
// _dateparser.py's base DateParser class (English is Gramps' own base/
// default locale for parsing, so these are its class-attribute dicts
// directly -- modifier_to_int, quality_to_int, bce, newyear_to_int -- not a
// locale-specific override).
//
// Original:
//   Gramps - a GTK+/GNOME based genealogy program
//   Copyright (C) 2013  Vassilii Khachaturov  (_datestrings.py)
//   Copyright (C) 2004-2006  Donald N. Allingham
//   Copyright (C) 2013       Vassilii Khachaturov
//   Copyright (C) 2014-2018  Paul Franklin      (_datedisplay.py)
//   Copyright (C) 2004-2006  Donald N. Allingham
//   Copyright (C) 2017       Paul Franklin
//   Copyright (c) 2020       Steve Youngs        (_dateparser.py)
//   Licensed under the GNU General Public License, version 2 or later.
//   https://github.com/gramps-project/gramps/tree/master/gramps/gen/datehandler

import type { DateLocale } from "../locale";
import { Calendar, Modifier, NewYear, Quality } from "../types";

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

  // Port of DateParser's modifier_to_int -- modifiers before the date.
  modifierWords: {
    before: Modifier.BEFORE, bef: Modifier.BEFORE, "bef.": Modifier.BEFORE,
    after: Modifier.AFTER, aft: Modifier.AFTER, "aft.": Modifier.AFTER,
    about: Modifier.ABOUT, "abt.": Modifier.ABOUT, abt: Modifier.ABOUT,
    circa: Modifier.ABOUT, "c.": Modifier.ABOUT, around: Modifier.ABOUT,
    from: Modifier.FROM, to: Modifier.TO,
  },

  // English has no after-date modifiers (that's a Finnish-style locale's
  // modifier_after_to_int, which is empty on DateParser's own base class too).
  modifierWordsAfterDate: {},

  // Port of quality_to_int.
  qualityWords: {
    estimated: Quality.ESTIMATED, "est.": Quality.ESTIMATED, est: Quality.ESTIMATED,
    "calc.": Quality.CALCULATED, calc: Quality.CALCULATED, calculated: Quality.CALCULATED,
  },

  // Port of the bce list.
  bceWords: ["B.C.E.", "B.C.E", "BCE", "B.C.", "B.C", "BC"],

  // Port of calendar_to_int -- includes "gregorian" (unlike calendarNames
  // above, which is display-only and suppresses it) since a user can type
  // "(Gregorian)" explicitly.
  calendarWords: {
    gregorian: Calendar.GREGORIAN,
    julian: Calendar.JULIAN,
    hebrew: Calendar.HEBREW,
    "french republican": Calendar.FRENCH,
    persian: Calendar.PERSIAN,
    islamic: Calendar.ISLAMIC,
    swedish: Calendar.SWEDISH,
  },

  // Port of newyear_to_int.
  newyearWords: {
    jan1: NewYear.JAN1,
    mar1: NewYear.MAR1,
    mar25: NewYear.MAR25,
    sep1: NewYear.SEP1,
  },

  numericOrder: "mdy",
};
