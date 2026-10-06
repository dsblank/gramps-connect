// Shared by DisplaySettingsPanel.tsx and ImportDesktopSettingsDialog.tsx:
// how the six date formats are named and previewed.
import { DateFormat, formatDate, parseDate } from "@gramps-connect/gramps-date";
import { t } from "../i18n/i18n";

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  [DateFormat.ISO]: "YYYY-MM-DD (ISO)",
  [DateFormat.NUMERIC]: "Numerical",
  [DateFormat.LONG_MONTH_DAY_YEAR]: "Month Day, Year",
  [DateFormat.SHORT_MONTH_DAY_YEAR]: "MON DAY, YEAR",
  [DateFormat.DAY_LONG_MONTH_YEAR]: "Day Month Year",
  [DateFormat.DAY_SHORT_MONTH_YEAR]: "DAY MON YEAR",
};

const SAMPLE_DATE = parseDate("1854-03-12");

/** "Day Month Year — 12 March 1854" */
export function describeDateFormat(format: DateFormat): string {
  return `${t(DATE_FORMAT_LABELS[format])}  —  ${formatDate(SAMPLE_DATE, { format })}`;
}
