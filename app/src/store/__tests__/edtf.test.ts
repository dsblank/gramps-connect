import { describe, expect, it } from "vitest";
import { Calendar, Modifier, Quality, type GrampsDate } from "@gramps-connect/gramps-date";
import { toEdtf } from "../edtf";

function date(
  dateval: GrampsDate["dateval"],
  modifier = Modifier.NONE,
  quality = Quality.NONE,
  extra: Partial<GrampsDate> = {},
): GrampsDate {
  return { modifier, quality, calendar: Calendar.GREGORIAN, dateval, text: "", newyear: 0, ...extra };
}

describe("toEdtf", () => {
  it("writes year, month and day precision", () => {
    expect(toEdtf(date([12, 3, 1850, false]))).toBe("1850-03-12");
    expect(toEdtf(date([0, 3, 1850, false]))).toBe("1850-03");
    expect(toEdtf(date([0, 0, 1850, false]))).toBe("1850");
    expect(toEdtf(date([0, 0, 850, false]))).toBe("0850");
  });

  it("marks about/estimated/calculated as approximate", () => {
    expect(toEdtf(date([0, 0, 1850, false], Modifier.ABOUT))).toBe("1850~");
    expect(toEdtf(date([0, 0, 1850, false], Modifier.NONE, Quality.ESTIMATED))).toBe("1850~");
    expect(toEdtf(date([0, 0, 1850, false], Modifier.NONE, Quality.CALCULATED))).toBe("1850~");
    expect(toEdtf(date([0, 0, 1850, false], Modifier.ABOUT, Quality.ESTIMATED))).toBe("1850~");
  });

  it("writes before/after/from/to as open intervals", () => {
    expect(toEdtf(date([0, 0, 1850, false], Modifier.BEFORE))).toBe("../1850");
    expect(toEdtf(date([0, 0, 1850, false], Modifier.TO))).toBe("../1850");
    expect(toEdtf(date([0, 0, 1850, false], Modifier.AFTER))).toBe("1850/..");
    expect(toEdtf(date([0, 0, 1850, false], Modifier.FROM))).toBe("1850/..");
  });

  it("writes a span as an interval and a range as one-of", () => {
    expect(toEdtf(date([0, 0, 1850, false, 0, 0, 1860, false], Modifier.SPAN))).toBe("1850/1860");
    expect(toEdtf(date([0, 0, 1850, false, 0, 0, 1860, false], Modifier.RANGE))).toBe("[1850..1860]");
    expect(toEdtf(date([0, 0, 1850, false, 0, 0, 1860, false], Modifier.RANGE, Quality.ESTIMATED))).toBe("[1850~..1860~]");
    expect(toEdtf(date([0, 0, 1850, false, 0, 0, 0, false], Modifier.SPAN))).toBeUndefined();
  });

  it("gives nothing rather than something wrong", () => {
    expect(toEdtf(undefined)).toBeUndefined();
    expect(toEdtf(date([0, 0, 0, false]))).toBeUndefined();
    expect(toEdtf(date([0, 0, 1850, true]))).toBeUndefined(); // dual-dated
    expect(toEdtf(date([0, 0, 1850, false], Modifier.TEXTONLY, Quality.NONE, { text: "spring" }))).toBeUndefined();
    expect(toEdtf(date([0, 0, 1850, false], Modifier.NONE, Quality.NONE, { calendar: Calendar.JULIAN }))).toBeUndefined();
    expect(toEdtf(date([0, 0, 1850, false], Modifier.NONE, Quality.NONE, { newyear: 3 as GrampsDate["newyear"] }))).toBeUndefined();
  });
});
