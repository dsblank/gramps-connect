// Builds a DateLocale from a generated strings file (<code>.generated.ts,
// written by scripts/generate_gramps_locales.py from Gramps' live
// displayer/parser) plus the hand-written parts: layouts and the mapping
// from this package's six DateFormat values to the language's numbered
// formats.

import type { DateLocale } from "../locale";
import type { GregorianLayout } from "../layouts";
import { NewYear } from "../types";

/** The shape of a generated strings file -- loose on purpose (`as const`
 * literals from JSON), narrowed into DateLocale's types below. */
export interface GrampsStrings {
  code: string;
  longMonths: readonly string[];
  shortMonths: readonly string[];
  hebrewMonths: readonly string[];
  frenchMonths: readonly string[];
  islamicMonths: readonly string[];
  persianMonths: readonly string[];
  calendarNames: readonly string[];
  modifierStrings: readonly string[];
  qualityStrings: readonly string[];
  numericFormat: string;
  bceFormat: string;
  templates: { span: string; range: string; modifiers: readonly string[] };
  modifierWords: Readonly<Record<string, number>>;
  modifierWordsAfterDate: Readonly<Record<string, number>>;
  qualityWords: Readonly<Record<string, number>>;
  calendarWords: Readonly<Record<string, number>>;
  bceWords: readonly string[];
  monthWords: Readonly<Record<string, number>>;
  textPatterns: DateLocale["textPatterns"];
  spanPattern: string;
  rangePattern: string;
  numericOrder: string;
  formatNames: readonly string[];
}

// Not translated in Gramps either: weekday names aren't used by display or
// parsing, and the new-year codes are the same in every language.
const DAYS = ["", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_DAYS = ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const NEWYEAR_WORDS = { jan1: NewYear.JAN1, mar1: NewYear.MAR1, mar25: NewYear.MAR25, sep1: NewYear.SEP1 };

export function fromGramps(
  strings: GrampsStrings,
  layout: { gregorianLayouts: readonly GregorianLayout[]; formatIndex: Readonly<Record<number, number>> },
): DateLocale {
  return {
    code: strings.code,
    longMonths: strings.longMonths,
    shortMonths: strings.shortMonths,
    hebrewMonths: strings.hebrewMonths,
    frenchMonths: strings.frenchMonths,
    islamicMonths: strings.islamicMonths,
    persianMonths: strings.persianMonths,
    longDays: DAYS,
    shortDays: SHORT_DAYS,
    calendarNames: strings.calendarNames,
    modifierStrings: strings.modifierStrings as unknown as DateLocale["modifierStrings"],
    qualityStrings: strings.qualityStrings as unknown as DateLocale["qualityStrings"],
    numericFormat: strings.numericFormat,
    bceFormat: strings.bceFormat,
    modifierWords: strings.modifierWords as DateLocale["modifierWords"],
    modifierWordsAfterDate: strings.modifierWordsAfterDate as DateLocale["modifierWordsAfterDate"],
    qualityWords: strings.qualityWords as DateLocale["qualityWords"],
    bceWords: strings.bceWords,
    calendarWords: strings.calendarWords as DateLocale["calendarWords"],
    newyearWords: NEWYEAR_WORDS,
    numericOrder: strings.numericOrder as DateLocale["numericOrder"],
    gregorianLayouts: layout.gregorianLayouts,
    formatNames: strings.formatNames,
    formatIndex: layout.formatIndex,
    templates: strings.templates,
    spanPattern: strings.spanPattern,
    rangePattern: strings.rangePattern,
    monthWords: strings.monthWords,
    textPatterns: strings.textPatterns,
  };
}

/** The six DateFormat values -> the same-numbered format, for languages
 * that keep Gramps' base order. */
export const IDENTITY_FORMAT_INDEX: Readonly<Record<number, number>> = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };
