import { test } from "node:test";
import assert from "node:assert/strict";

import { toEdtf } from "../edtf";
import { Calendar, Modifier, Quality, type GrampsDate } from "../types";

function date(
  dateval: GrampsDate["dateval"],
  modifier = Modifier.NONE,
  quality = Quality.NONE,
  extra: Partial<GrampsDate> = {},
): GrampsDate {
  return { modifier, quality, calendar: Calendar.GREGORIAN, dateval, text: "", newyear: 0, ...extra };
}

test("toEdtf writes year, month and day precision", () => {
  assert.equal(toEdtf(date([12, 3, 1850, false])), "1850-03-12");
  assert.equal(toEdtf(date([0, 3, 1850, false])), "1850-03");
  assert.equal(toEdtf(date([0, 0, 1850, false])), "1850");
  assert.equal(toEdtf(date([0, 0, 850, false])), "0850");
});

test("toEdtf marks about/estimated/calculated as approximate", () => {
  assert.equal(toEdtf(date([0, 0, 1850, false], Modifier.ABOUT)), "1850~");
  assert.equal(toEdtf(date([0, 0, 1850, false], Modifier.NONE, Quality.ESTIMATED)), "1850~");
  assert.equal(toEdtf(date([0, 0, 1850, false], Modifier.NONE, Quality.CALCULATED)), "1850~");
  assert.equal(toEdtf(date([0, 0, 1850, false], Modifier.ABOUT, Quality.ESTIMATED)), "1850~");
});

test("toEdtf writes before/after/from/to as open intervals", () => {
  assert.equal(toEdtf(date([0, 0, 1850, false], Modifier.BEFORE)), "../1850");
  assert.equal(toEdtf(date([0, 0, 1850, false], Modifier.TO)), "../1850");
  assert.equal(toEdtf(date([0, 0, 1850, false], Modifier.AFTER)), "1850/..");
  assert.equal(toEdtf(date([0, 0, 1850, false], Modifier.FROM)), "1850/..");
});

test("toEdtf writes a span as an interval and a range as one-of", () => {
  assert.equal(toEdtf(date([0, 0, 1850, false, 0, 0, 1860, false], Modifier.SPAN)), "1850/1860");
  assert.equal(toEdtf(date([0, 0, 1850, false, 0, 0, 1860, false], Modifier.RANGE)), "[1850..1860]");
  assert.equal(toEdtf(date([0, 0, 1850, false, 0, 0, 1860, false], Modifier.RANGE, Quality.ESTIMATED)), "[1850~..1860~]");
  assert.equal(toEdtf(date([0, 0, 1850, false, 0, 0, 0, false], Modifier.SPAN)), undefined);
});

test("toEdtf gives nothing rather than something wrong", () => {
  assert.equal(toEdtf(undefined), undefined);
  assert.equal(toEdtf(date([0, 0, 0, false])), undefined);
  assert.equal(toEdtf(date([0, 0, 1850, true])), undefined); // dual-dated
  assert.equal(toEdtf(date([0, 0, 1850, false], Modifier.TEXTONLY, Quality.NONE, { text: "spring" })), undefined);
  assert.equal(toEdtf(date([0, 0, 1850, false], Modifier.NONE, Quality.NONE, { calendar: Calendar.JULIAN })), undefined);
  assert.equal(toEdtf(date([0, 0, 1850, false], Modifier.NONE, Quality.NONE, { newyear: 3 as GrampsDate["newyear"] })), undefined);
});
