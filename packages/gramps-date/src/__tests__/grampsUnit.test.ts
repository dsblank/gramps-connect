// Gramps' own hand-written date tests that apply to this package, ported
// one-for-one (each test names its original). The large generated date
// sets those test modules build live in grampsTests.test.ts instead.
//
// Not ported: the Russian inflection/variant tests (no "ru" locale here
// yet -- see locales/fromGramps.ts), DateHandlerTest's argument-count
// checks (TypeScript's DatePart type already rules those out), and
// date_test.py's matching/comparison/arithmetic/age tests (this package
// doesn't implement those operations).
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDate } from "../parse";
import { makeDate, validateDate } from "../entry";
import { getLocale } from "../locale";
import { Calendar, Modifier, Quality } from "../types";

const en = getLocale("en");

// --- gen/datehandler/test/dateparser_test.py ---

test("DateParserTest.test_month_to_int_jan_is_1", () => {
  assert.deepEqual(parseDate("jan 1900").dateval, [0, 1, 1900, false]);
});

test("DateParserTest.test_calendar_to_int_gregorian", () => {
  assert.equal(en.calendarWords["gregorian"], Calendar.GREGORIAN);
  assert.equal(en.calendarWords["g"], Calendar.GREGORIAN);
});

test("DateParserTest.test_calendar_to_int_julian", () => {
  assert.equal(en.calendarWords["julian"], Calendar.JULIAN);
  assert.equal(en.calendarWords["j"], Calendar.JULIAN);
});

for (const [quarter, start, stop] of [
  [1, [1, 1, 1900], [31, 3, 1900]],
  [2, [1, 4, 1900], [30, 6, 1900]],
  [3, [1, 7, 1900], [30, 9, 1900]],
  [4, [1, 10, 1900], [31, 12, 1900]],
] as const) {
  test(`DateParserTest.test_quarter_${quarter}`, () => {
    const date = parseDate(`q${quarter} 1900`);
    assert.deepEqual(date, parseDate(`Q${quarter} 1900`));
    assert.deepEqual(date.dateval, [...start, false, ...stop, false]);
    assert.equal(date.modifier, Modifier.RANGE);
  });
}

test("DateParserTest.test_quarter_quality_calendar", () => {
  const date = parseDate("calc q1 1900 (julian)");
  assert.equal(date.quality, Quality.CALCULATED);
  assert.equal(date.calendar, Calendar.JULIAN);
});

// --- gen/datehandler/test/datestrings_test.py (English) ---

test("DateStringsTest.testTwelfthMonthIsDecember", () => {
  assert.equal(en.longMonths[12], "December");
  assert.equal(en.shortMonths[12], "Dec");
});

test("DateStringsTest.testEnAdarI_in_AdarII", () => {
  assert.ok(en.hebrewMonths[7].includes(en.hebrewMonths[6]));
});

test("DateStringsTest.testEnLastFrenchIsExtra", () => {
  assert.equal(en.frenchMonths[en.frenchMonths.length - 1], "Extra");
});

test("DateStringsTest.testEnPersianKhordadMordad", () => {
  assert.equal(en.persianMonths[3].toLowerCase(), "khordad");
  assert.equal(en.persianMonths[5].toLowerCase(), "mordad");
});

test("DateStringsTest.testEnIslamicRamadan9", () => {
  assert.equal(en.islamicMonths[9], "Ramadan");
});

test("DateStringsTest.testFirstStringEmpty", () => {
  assert.equal(en.longMonths[0], "");
  assert.equal(en.shortMonths[0], "");
  assert.equal(en.longDays[0], "");
});

test("DateStringsTest.testCalendarIndex", () => {
  // DateStrings.calendar names Gregorian too; the displayer blanks that slot
  // ("gregorian cal name shouldn't be output!") and the parser keeps it.
  assert.deepEqual(en.calendarNames.slice(1), ["Julian", "Hebrew", "French Republican", "Persian", "Islamic", "Swedish"]);
  assert.equal(en.calendarNames[Calendar.GREGORIAN], "");
  assert.equal(en.calendarWords["gregorian"], Calendar.GREGORIAN);
});

test("DateStringsTest.testDayNamesLenIs8", () => {
  assert.equal(en.longDays.length, 8);
});

// --- gen/datehandler/test/datehandler_test.py: Date.set() rejects these
// (DateError); here validateDate() reports them invalid. ---

function invalid(input: Parameters<typeof makeDate>[0]): boolean {
  return !validateDate(makeDate(input)).valid;
}

test("DateHandlerTest.test_invalid_day", () => {
  assert.ok(invalid({ start: [44, 7, 1789, false] }));
});

test("DateHandlerTest.test_invalid_month", () => {
  assert.ok(invalid({ start: [4, 77, 1789, false] }));
});

test("DateHandlerTest.test_invalid_month_with_ny", () => {
  assert.ok(invalid({ start: [4, 77, 1789, false], newyear: 2 }));
});

test("DateHandlerTest.test_invalid_span_day", () => {
  assert.ok(invalid({ modifier: Modifier.SPAN, start: [4, 7, 1789, false], stop: [55, 8, 1876, false] }));
});

test("DateHandlerTest.test_invalid_span_month", () => {
  assert.ok(invalid({ modifier: Modifier.SPAN, start: [4, 7, 1789, false], stop: [5, 88, 1876, false] }));
});
