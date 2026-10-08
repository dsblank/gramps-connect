// Builds a DateLocale from a generated strings file (<code>.generated.ts,
// written by scripts/generate_gramps_locales.py from Gramps' live
// displayer/parser) plus the hand-written parts: layouts and the mapping
// from this package's six DateFormat values to the language's numbered
// formats.

import type { DateLocale, Inflection } from "../locale";
import { baseLayouts, type BaseTextTemplates, type GregorianLayout } from "../layouts";
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
  templates: readonly { span: string; range: string; modifiers: readonly string[] }[];
  modifierWords: Readonly<Record<string, number>>;
  modifierWordsAfterDate: Readonly<Record<string, number>>;
  qualityWords: Readonly<Record<string, number>>;
  calendarWords: Readonly<Record<string, number>>;
  bceWords: readonly string[];
  textPatterns: DateLocale["textPatterns"];
  parserPatterns: DateLocale["parserPatterns"];
  monthTables: DateLocale["monthTables"];
  rfcMonths: Readonly<Record<string, number>>;
  numericOrder: string;
  numericWeekdayFirst: boolean;
  baseTextTemplates: BaseTextTemplates;
  shortDays: readonly string[];
  longDays: readonly string[];
  yearSuffix: string;
  altLongMonths: readonly string[] | null;
  romanMonths?: readonly string[] | null;
  inflection?: Inflection | null;
  formatNames: readonly string[];
}

// The new-year codes are the same in every language.
const NEWYEAR_WORDS = { jan1: NewYear.JAN1, mar1: NewYear.MAR1, mar25: NewYear.MAR25, sep1: NewYear.SEP1 };

/** `layout` null: the language's base layouts, from its translated
 * templates (most languages -- their displayers don't override the
 * Gregorian layout). */
export function fromGramps(
  strings: GrampsStrings,
  layout: {
    gregorianLayouts?: readonly GregorianLayout[];
    formatIndex?: Readonly<Record<number, number>>;
    display?: DateLocale["display"];
    numericLstrip?: boolean;
    layoutsForAllCalendars?: boolean;
  } | null,
): DateLocale {
  const base = baseLayouts(strings.baseTextTemplates);
  return {
    code: strings.code,
    longMonths: strings.longMonths,
    shortMonths: strings.shortMonths,
    hebrewMonths: strings.hebrewMonths,
    frenchMonths: strings.frenchMonths,
    islamicMonths: strings.islamicMonths,
    persianMonths: strings.persianMonths,
    longDays: strings.longDays,
    shortDays: strings.shortDays,
    yearSuffix: strings.yearSuffix,
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
    numericWeekdayFirst: strings.numericWeekdayFirst,
    gregorianLayouts: layout?.gregorianLayouts ?? base,
    baseLayouts: base,
    formatNames: strings.formatNames,
    formatIndex: layout?.formatIndex ?? IDENTITY_FORMAT_INDEX,
    templates: strings.templates,
    display: layout?.display,
    numericLstrip: layout?.numericLstrip,
    layoutsForAllCalendars: layout?.layoutsForAllCalendars,
    altLongMonths: strings.altLongMonths,
    romanMonths: strings.romanMonths ? withThirteenth(strings.romanMonths) : null,
    inflection: strings.inflection ?? null,
    parserPatterns: strings.parserPatterns,
    monthTables: strings.monthTables,
    rfcMonths: strings.rfcMonths,
    textPatterns: strings.textPatterns,
  };
}

/** The six DateFormat values -> the same-numbered format, for languages
 * that keep Gramps' base order. */
export const IDENTITY_FORMAT_INDEX: Readonly<Record<number, number>> = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };

/** A language's Roman month list, through month 13 for the Hebrew and
 * French calendars: Gramps' Hungarian list ("I.".."XII.") stops at 12, so
 * Gramps raises IndexError for those months (a Gramps bug, fixed here).
 * The added numeral takes the list's own suffix ("XIII."). */
function withThirteenth(months: readonly string[]): readonly string[] {
  if (months.length > 13) return months;
  const suffix = months[1].slice(1);
  return [...months, `XIII${suffix}`];
}
