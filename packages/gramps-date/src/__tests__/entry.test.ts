import { test } from "node:test";
import assert from "node:assert/strict";

import { makeDate, validateDate, emptyDate } from "../entry";
import { Modifier, Calendar } from "../types";
import { formatDate } from "../display";

test("makeDate builds a simple date with computed sortval", () => {
  const d = makeDate({ start: [25, 11, 1914, false] });
  assert.deepEqual(d.dateval, [25, 11, 1914, false]);
  assert.equal(d.modifier, Modifier.NONE);
  assert.equal(typeof d.sortval, "number");
  assert.ok(d.sortval! > 0);
  assert.equal(formatDate(d), "25 Nov 1914");
});

test("makeDate builds a range with an 8-element dateval", () => {
  const d = makeDate({
    modifier: Modifier.RANGE,
    start: [1, 1, 1920],
    stop: [31, 12, 1930],
  });
  assert.deepEqual(d.dateval, [1, 1, 1920, false, 31, 12, 1930, false]);
  assert.equal(formatDate(d), "between 1 Jan 1920 and 31 Dec 1930");
});

test("emptyDate round-trips through formatDate as empty string", () => {
  assert.equal(formatDate(emptyDate()), "");
});

test("validateDate: a well-formed simple date is valid", () => {
  const d = makeDate({ start: [25, 11, 1914, false] });
  const result = validateDate(d);
  assert.equal(result.valid, true);
  assert.equal(result.date1Invalid, false);
});

test("validateDate: Feb 30 is invalid", () => {
  const d = makeDate({ start: [30, 2, 2000, false] });
  const result = validateDate(d);
  assert.equal(result.date1Invalid, true);
  assert.equal(result.valid, false);
});

test("validateDate: a well-formed range is valid", () => {
  const d = makeDate({ modifier: Modifier.RANGE, start: [1, 1, 1920], stop: [31, 12, 1930] });
  assert.equal(validateDate(d).valid, true);
});

test("validateDate: range with stop before start is invalid", () => {
  const d = makeDate({ modifier: Modifier.RANGE, start: [1, 1, 1930], stop: [31, 12, 1920] });
  const result = validateDate(d);
  assert.equal(result.date2OrderInvalid, true);
  assert.equal(result.valid, false);
});

test("validateDate: range with an empty stop date is invalid", () => {
  const d = makeDate({ modifier: Modifier.RANGE, start: [1, 1, 1920] });
  const result = validateDate(d);
  assert.equal(result.date2Empty, true);
  assert.equal(result.valid, false);
});

test("validateDate: partial (year-only) date is valid", () => {
  const d = makeDate({ start: [0, 0, 1900, false] });
  assert.equal(validateDate(d).valid, true);
});

test("validateDate: non-Gregorian calendar validity is calendar-specific", () => {
  // Feb 30 is invalid on the Gregorian calendar but the French Republican
  // calendar has 30-day months throughout, so its own "Feb 30"-shaped
  // date (month 2, day 30) is fine.
  const gregorian = makeDate({ calendar: Calendar.GREGORIAN, start: [30, 2, 2000, false] });
  const french = makeDate({ calendar: Calendar.FRENCH, start: [30, 2, 5, false] });
  assert.equal(validateDate(gregorian).valid, false);
  assert.equal(validateDate(french).valid, true);
});
