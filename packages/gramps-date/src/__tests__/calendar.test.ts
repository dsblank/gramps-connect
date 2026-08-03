import { test } from "node:test";
import assert from "node:assert/strict";

import {
  gregorianSdn, gregorianYmd,
  julianSdn, julianYmd,
  frenchSdn, frenchYmd,
  islamicSdn, islamicYmd,
  swedishSdn, swedishYmd,
  isValidCalendarDate,
  dateToSdn,
} from "../calendar";
import { Calendar } from "../types";

test("Gregorian round-trip", () => {
  assert.deepEqual(gregorianYmd(gregorianSdn(1914, 11, 25)), [1914, 11, 25]);
  assert.deepEqual(gregorianYmd(gregorianSdn(1, 1, 1)), [1, 1, 1]);
});

test("Julian round-trip", () => {
  assert.deepEqual(julianYmd(julianSdn(1750, 2, 4)), [1750, 2, 4]);
});

test("French Republican round-trip", () => {
  assert.deepEqual(frenchYmd(frenchSdn(3, 5, 18)), [3, 5, 18]);
});

test("Islamic round-trip", () => {
  assert.deepEqual(islamicYmd(islamicSdn(1445, 9, 1)), [1445, 9, 1]);
});

test("Swedish calendar: the unique 1712 leap day", () => {
  assert.deepEqual(swedishYmd(swedishSdn(1712, 2, 30)), [1712, 2, 30]);
});

test("Swedish calendar: Gregorian after 1753-03-01", () => {
  assert.deepEqual(swedishYmd(swedishSdn(1800, 6, 15)), [1800, 6, 15]);
});

// Known SDN <-> Gregorian anchor, from gramps/gen/lib/gcalendar.py's own
// convention (SDN == Julian Day Number): 2000-01-01 is SDN 2451545.
test("Gregorian SDN matches a known anchor date", () => {
  assert.equal(gregorianSdn(2000, 1, 1), 2451545);
});

test("isValidCalendarDate: Feb 29 valid only in a leap year", () => {
  assert.equal(isValidCalendarDate(Calendar.GREGORIAN, 2000, 2, 29), true); // leap
  assert.equal(isValidCalendarDate(Calendar.GREGORIAN, 1900, 2, 29), false); // not a leap year
  assert.equal(isValidCalendarDate(Calendar.GREGORIAN, 2023, 2, 29), false); // not a leap year
});

test("isValidCalendarDate: month 13 is invalid on Gregorian", () => {
  assert.equal(isValidCalendarDate(Calendar.GREGORIAN, 2000, 13, 1), false);
});

test("isValidCalendarDate: partial dates (month/day unset) always valid", () => {
  assert.equal(isValidCalendarDate(Calendar.GREGORIAN, 2000, 0, 0), true);
  assert.equal(isValidCalendarDate(Calendar.GREGORIAN, 0, 0, 0), true);
});

test("isValidCalendarDate: Hebrew/Persian always valid (unimplemented)", () => {
  assert.equal(isValidCalendarDate(Calendar.HEBREW, 2000, 99, 99), true);
  assert.equal(isValidCalendarDate(Calendar.PERSIAN, 2000, 99, 99), true);
});

test("dateToSdn: unspecified date is SDN 0", () => {
  assert.equal(dateToSdn(Calendar.GREGORIAN, 0, 0, 0), 0);
});

test("dateToSdn matches gregorianSdn for a full date", () => {
  assert.equal(dateToSdn(Calendar.GREGORIAN, 1914, 11, 25), gregorianSdn(1914, 11, 25));
});
