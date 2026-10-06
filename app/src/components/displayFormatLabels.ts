// Shared by DisplaySettingsPanel.tsx and ImportDesktopSettingsDialog.tsx:
// how the six date formats are named and previewed -- in the interface
// language, with Gramps' own name for the matching format there ("Tag.
// Monat Jahr"), as desktop's Preferences shows it.
import { DateFormat, formatDate, getLocale, parseDate } from "@gramps-connect/gramps-date";
import { dateLocaleCode } from "../store/placeIndex";

/** The six formats, in DateFormat order. */
export const DATE_FORMATS: DateFormat[] = [
  DateFormat.ISO,
  DateFormat.NUMERIC,
  DateFormat.LONG_MONTH_DAY_YEAR,
  DateFormat.SHORT_MONTH_DAY_YEAR,
  DateFormat.DAY_LONG_MONTH_YEAR,
  DateFormat.DAY_SHORT_MONTH_YEAR,
];

const SAMPLE_DATE = parseDate("1854-03-12");

/** One of a language's own numbered formats: "Tag. Monat Jahr — 12. März
 * 1854". */
export function describeGrampsFormat(localeCode: string, index: number): string {
  const locale = getLocale(localeCode);
  return `${locale.formatNames[index] ?? ""}  —  ${formatDate(SAMPLE_DATE, { grampsFormat: index, locale })}`;
}

/** One of the six shared formats, as the interface language names and
 * writes it. */
export function describeDateFormat(format: DateFormat): string {
  const localeCode = dateLocaleCode();
  return describeGrampsFormat(localeCode, getLocale(localeCode).formatIndex[format] ?? format);
}
