import { test } from "node:test";
import assert from "node:assert/strict";

import { formatDate, DateFormat, Modifier, Quality, Calendar, NewYear, type GrampsDate } from "../index";

function date(overrides: Partial<GrampsDate>): GrampsDate {
  return {
    _class: "Date",
    modifier: Modifier.NONE,
    quality: Quality.NONE,
    calendar: Calendar.GREGORIAN,
    dateval: [0, 0, 0, false],
    text: "",
    newyear: NewYear.JAN1,
    ...overrides,
  };
}

test("plain date, day-short-month-year (default format)", () => {
  const d = date({ dateval: [25, 11, 1914, false] });
  assert.equal(formatDate(d), "25 Nov 1914");
});

// Live API response captured this session: I00001, death event, dateval
// [21, 4, 1879, false] -- see the conversation's earlier curl output.
test("matches a real gramps-web-api response", () => {
  const d = date({ dateval: [21, 4, 1879, false] });
  assert.equal(formatDate(d), "21 Apr 1879");
});

test("modifiers: before/after/about", () => {
  const start: GrampsDate["dateval"] = [1, 1, 1960, false];
  assert.equal(formatDate(date({ modifier: Modifier.BEFORE, dateval: start })), "before 1 Jan 1960");
  assert.equal(formatDate(date({ modifier: Modifier.AFTER, dateval: start })), "after 1 Jan 1960");
  assert.equal(formatDate(date({ modifier: Modifier.ABOUT, dateval: start })), "about 1 Jan 1960");
});

test("year-only date (day/month unset)", () => {
  const d = date({ modifier: Modifier.BEFORE, dateval: [0, 0, 1960, false] });
  assert.equal(formatDate(d), "before 1960");
});

test("range: between X and Y", () => {
  const d = date({
    modifier: Modifier.RANGE,
    dateval: [1, 1, 1920, false, 31, 12, 1930, false],
  });
  assert.equal(formatDate(d), "between 1 Jan 1920 and 31 Dec 1930");
});

test("span: from X to Y", () => {
  const d = date({
    modifier: Modifier.SPAN,
    dateval: [1, 1, 1914, false, 1, 1, 1918, false],
  });
  assert.equal(formatDate(d), "from 1 Jan 1914 to 1 Jan 1918");
});

test("quality: estimated / calculated prefix", () => {
  const start: GrampsDate["dateval"] = [1, 6, 1900, false];
  assert.equal(formatDate(date({ quality: Quality.ESTIMATED, dateval: start })), "estimated 1 Jun 1900");
  assert.equal(formatDate(date({ quality: Quality.CALCULATED, dateval: start })), "calculated 1 Jun 1900");
});

test("quality and modifier combine", () => {
  const d = date({ modifier: Modifier.ABOUT, quality: Quality.ESTIMATED, dateval: [0, 0, 1850, false] });
  assert.equal(formatDate(d), "estimated about 1850");
});

test("non-Gregorian calendar gets a suffix", () => {
  const d = date({ calendar: Calendar.JULIAN, dateval: [4, 2, 1750, false] });
  assert.equal(formatDate(d), "4 Feb 1750 (Julian)");
});

test("non-Jan-1 new year gets a suffix", () => {
  const d = date({ dateval: [1, 3, 1700, false], newyear: NewYear.MAR25 });
  assert.equal(formatDate(d), "1 Mar 1700 (Mar25)");
});

test("calendar and new-year suffixes combine", () => {
  const d = date({ calendar: Calendar.JULIAN, dateval: [1, 3, 1700, false], newyear: NewYear.MAR25 });
  assert.equal(formatDate(d), "1 Mar 1700 (Julian, Mar25)");
});

test("BCE date", () => {
  const d = date({ dateval: [0, 0, -44, false] });
  assert.equal(formatDate(d), "44 B.C.E.");
});

test("text-only date ignores dateval entirely", () => {
  const d = date({ modifier: Modifier.TEXTONLY, text: "sometime in the 1800s", dateval: [1, 1, 9999, false] });
  assert.equal(formatDate(d), "sometime in the 1800s");
});

test("empty/unset date renders as empty string", () => {
  assert.equal(formatDate(date({})), "");
});

test("format: ISO", () => {
  const d = date({ dateval: [25, 11, 1914, false] });
  assert.equal(formatDate(d, { format: DateFormat.ISO }), "1914-11-25");
});

test("format: numeric", () => {
  const d = date({ dateval: [25, 11, 1914, false] });
  assert.equal(formatDate(d, { format: DateFormat.NUMERIC }), "11/25/1914");
});

test("format: long month, day, year", () => {
  const d = date({ dateval: [25, 11, 1914, false] });
  assert.equal(formatDate(d, { format: DateFormat.LONG_MONTH_DAY_YEAR }), "November 25, 1914");
});

test("format: day, long month, year", () => {
  const d = date({ dateval: [25, 11, 1914, false] });
  assert.equal(formatDate(d, { format: DateFormat.DAY_LONG_MONTH_YEAR }), "25 November 1914");
});

test("slash year", () => {
  const d = date({ dateval: [1, 1, 1746, true] });
  assert.equal(formatDate(d), "1 Jan 1745/6");
});
