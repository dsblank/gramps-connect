import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDate } from "../parse";
import { makeDate } from "../entry";
import { formatDate } from "../display";
import { Calendar, Modifier, NewYear, Quality } from "../types";

test("plain month day, year", () => {
  const d = parseDate("Jan 1, 1983");
  assert.equal(d.modifier, Modifier.NONE);
  assert.deepEqual(d.dateval, [1, 1, 1983, false]);
});

test("month year (no day)", () => {
  const d = parseDate("January 1983");
  assert.deepEqual(d.dateval, [0, 1, 1983, false]);
});

test("day month-name year (text2 order)", () => {
  const d = parseDate("1 January 1983");
  assert.deepEqual(d.dateval, [1, 1, 1983, false]);
});

test("modifier: about", () => {
  const d = parseDate("about Jan 1, 1983");
  assert.equal(d.modifier, Modifier.ABOUT);
  assert.deepEqual(d.dateval, [1, 1, 1983, false]);
});

test("modifier abbreviations and synonyms", () => {
  assert.equal(parseDate("bef 1960").modifier, Modifier.BEFORE);
  assert.equal(parseDate("aft. 1960").modifier, Modifier.AFTER);
  assert.equal(parseDate("circa 1960").modifier, Modifier.ABOUT);
  assert.equal(parseDate("c. 1960").modifier, Modifier.ABOUT);
  assert.equal(parseDate("around 1960").modifier, Modifier.ABOUT);
});

// "Jan" is a Gregorian-only month word -- it doesn't match Hebrew's own
// month vocabulary (Tishri, Heshvan, ...), so "Jan 1, 1983 (Hebrew,Jan1)"
// literally typed isn't parseable in real Gramps either (confirmed against
// the numeric/Hebrew-month-name equivalents below, which do parse): the
// month must either be numeric or spelled in the target calendar's own
// terms. This is the numeric form of the user's own worked example.
test("the user's own worked example, numeric form: about 1/1/1983 (Hebrew,Jan1)", () => {
  const d = parseDate("about 1/1/1983 (Hebrew,Jan1)");
  assert.equal(d.modifier, Modifier.ABOUT);
  assert.equal(d.calendar, Calendar.HEBREW);
  assert.equal(d.newyear, NewYear.JAN1);
  assert.deepEqual(d.dateval, [1, 1, 1983, false]);
});

test("the user's own worked example, spelled out: about 1 Tishri 1983 (Hebrew,Jan1)", () => {
  const d = parseDate("about 1 Tishri 1983 (Hebrew,Jan1)");
  assert.equal(d.modifier, Modifier.ABOUT);
  assert.equal(d.calendar, Calendar.HEBREW);
  assert.equal(d.newyear, NewYear.JAN1);
  assert.deepEqual(d.dateval, [1, 1, 1983, false]);
});

test("calendar + custom newyear suffix (M-D form)", () => {
  const d = parseDate("1 Jan 1745 (Julian,3-25)");
  assert.equal(d.calendar, Calendar.JULIAN);
  assert.deepEqual(d.newyear, [3, 25]);
});

test("calendar suffix alone", () => {
  const d = parseDate("1 Jan 1745 (Julian)");
  assert.equal(d.calendar, Calendar.JULIAN);
});

test("standalone newyear suffix", () => {
  const d = parseDate("1 Jan 1745 (Mar25)");
  assert.equal(d.newyear, NewYear.MAR25);
  assert.equal(d.calendar, Calendar.GREGORIAN);
});

test("quality: estimated / calculated", () => {
  assert.equal(parseDate("estimated 1592").quality, Quality.ESTIMATED);
  assert.equal(parseDate("calc. 1592").quality, Quality.CALCULATED);
});

test("range: between X and Y", () => {
  const d = parseDate("between 1920 and 1930");
  assert.equal(d.modifier, Modifier.RANGE);
  assert.deepEqual(d.dateval, [0, 0, 1920, false, 0, 0, 1930, false]);
});

test("range abbreviation: bet.", () => {
  const d = parseDate("bet. 1920 and 1930");
  assert.equal(d.modifier, Modifier.RANGE);
});

test("span: from X to Y", () => {
  const d = parseDate("from 1920 to 1930");
  assert.equal(d.modifier, Modifier.SPAN);
  assert.deepEqual(d.dateval, [0, 0, 1920, false, 0, 0, 1930, false]);
});

test("French Republican quarter shorthand", () => {
  const d = parseDate("Q1 5");
  assert.equal(d.modifier, Modifier.RANGE);
  // Q1 -> months 1-3, so the range spans day 1 month 1 to the last day of month 3.
  assert.deepEqual(d.dateval, [1, 1, 5, false, 31, 3, 5, false]);
});

test("bracket-about shorthand", () => {
  const d = parseDate("<1960>");
  assert.equal(d.modifier, Modifier.ABOUT);
  assert.deepEqual(d.dateval, [0, 0, 1960, false]);
});

test("ISO date", () => {
  const d = parseDate("1983-01-25");
  assert.deepEqual(d.dateval, [25, 1, 1983, false]);
});

test("bare numeric, US month/day/year ordering", () => {
  const d = parseDate("3/4/1960");
  assert.deepEqual(d.dateval, [4, 3, 1960, false]);
});

test("year only", () => {
  const d = parseDate("1960");
  assert.deepEqual(d.dateval, [0, 0, 1960, false]);
});

test("dual-dated (slash) year, numeric", () => {
  const d = parseDate("1745/6");
  assert.deepEqual(d.dateval, [0, 0, 1746, true]);
  assert.equal(formatDate(d), "1745/6");
});

test("dual-dated (slash) year, with a month name", () => {
  const d = parseDate("1 Mar 1745/6");
  assert.equal(d.dateval[3], true);
  assert.equal(d.dateval[2], 1746);
});

test("BCE suffix", () => {
  const d = parseDate("100 BC");
  assert.equal(d.dateval[2], -100);
});

test("BCE with a modifier", () => {
  const d = parseDate("about 100 BC");
  assert.equal(d.modifier, Modifier.ABOUT);
  assert.equal(d.dateval[2], -100);
});

test("today shorthand", () => {
  const d = parseDate("today");
  const now = new Date();
  assert.deepEqual(d.dateval, [now.getDate(), now.getMonth() + 1, now.getFullYear(), false]);
});

test("$T shorthand", () => {
  const d = parseDate("$T");
  const now = new Date();
  assert.deepEqual(d.dateval, [now.getDate(), now.getMonth() + 1, now.getFullYear(), false]);
});

// Without an explicit "(Hebrew)" suffix the parser defaults to Gregorian
// and tries to match "Tishri" against *Gregorian* month names -- it
// doesn't match, and nothing else (ISO/numeric/today) matches "1 Tishri
// 5744" either, so this correctly falls back to Text only. Matches real
// Gramps: the calendar is never inferred from the month name alone, a
// calendar-specific month name with no calendar suffix just doesn't parse.
test("Hebrew month name without a calendar suffix falls back to Text only", () => {
  const d = parseDate("1 Tishri 5744");
  assert.equal(d.modifier, Modifier.TEXTONLY);
  assert.equal(d.text, "1 Tishri 5744");
});

test("Hebrew month name with explicit calendar", () => {
  const d = parseDate("1 Tishri 5744 (Hebrew)");
  assert.equal(d.calendar, Calendar.HEBREW);
  assert.deepEqual(d.dateval, [1, 1, 5744, false]);
});

test("unparseable text falls back to Text only", () => {
  const d = parseDate("this is not a date at all");
  assert.equal(d.modifier, Modifier.TEXTONLY);
  assert.equal(d.text, "this is not a date at all");
});

test("blank input parses to an empty (non-text-only) date", () => {
  const d = parseDate("");
  assert.equal(d.modifier, Modifier.NONE);
  assert.deepEqual(d.dateval, [0, 0, 0, false]);
});

test("round-trips through formatDate for a representative sample", () => {
  const samples = [
    makeDate({ start: [1, 1, 1983, false] }),
    makeDate({ modifier: Modifier.ABOUT, start: [0, 0, 1592, false] }),
    makeDate({ modifier: Modifier.BEFORE, start: [0, 0, 1960, false] }),
    makeDate({ modifier: Modifier.RANGE, start: [0, 0, 1920, false], stop: [0, 0, 1930, false] }),
    makeDate({ modifier: Modifier.SPAN, start: [0, 0, 1920, false], stop: [0, 0, 1930, false] }),
  ];
  for (const original of samples) {
    const formatted = formatDate(original);
    const reparsed = parseDate(formatted);
    assert.equal(formatDate(reparsed), formatted, `round-trip failed for "${formatted}"`);
  }
});
