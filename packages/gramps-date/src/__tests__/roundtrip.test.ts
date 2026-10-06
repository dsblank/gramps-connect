import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDate } from "../parse";
import { DateFormat, formatDate } from "../display";

// The app's date input shows dates in whichever DateFormat the tree's
// Preferences pick and reads the text back with parseDate() -- so every
// format has to round-trip, qualifiers and all.
const INPUTS = [
  "1854-03-12", "Mar 1854", "1854", "about 1854-03-12", "before 1900", "after 3 Jan 1900",
  "between 1890 and 1910", "from 1 Feb 1890 to 3 Mar 1910", "estimated 1800", "calculated 12 May 1820",
  "1745/6", "11 Feb 1745/6", "1700 (Julian)", "12 Jan 1700 (Julian)", "1 Jan 100 B.C.E.",
  "text only words", "3 Dec 1999",
];

const FORMATS = [
  DateFormat.ISO, DateFormat.NUMERIC, DateFormat.LONG_MONTH_DAY_YEAR,
  DateFormat.SHORT_MONTH_DAY_YEAR, DateFormat.DAY_LONG_MONTH_YEAR, DateFormat.DAY_SHORT_MONTH_YEAR,
];

for (const format of FORMATS) {
  test(`format ${DateFormat[format]} round-trips through parseDate`, () => {
    for (const input of INPUTS) {
      const date = parseDate(input);
      const back = parseDate(formatDate(date, { format }));
      assert.deepEqual(
        [back.modifier, back.quality, back.calendar, back.dateval, back.newyear],
        [date.modifier, date.quality, date.calendar, date.dateval, date.newyear],
        `${input} -> ${formatDate(date, { format })}`,
      );
    }
  });
}
