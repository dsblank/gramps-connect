/** This package's six date formats -- the base (English) Gramps numbering.
 * Each locale maps them onto its own numbered formats
 * (DateLocale.formatIndex). */
export enum DateFormat {
  ISO = 0,
  NUMERIC = 1,
  LONG_MONTH_DAY_YEAR = 2,
  SHORT_MONTH_DAY_YEAR = 3,
  DAY_LONG_MONTH_YEAR = 4,
  DAY_SHORT_MONTH_YEAR = 5,
}
