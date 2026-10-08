import { describe, expect, it } from "vitest";
import { Calendar } from "@gramps-connect/gramps-date";
import { calendarOptions } from "../DateInput";

const values = (options: { value: string }[]) => options.map((o) => Number(o.value));

describe("DateInput calendar choices", () => {
  it("offers the lunar calendars only when the server has them", () => {
    expect(values(calendarOptions(false, Calendar.GREGORIAN))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(values(calendarOptions(true, Calendar.GREGORIAN))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("keeps a date's own lunar calendar choosable on an older server", () => {
    expect(values(calendarOptions(false, Calendar.KOREAN_LUNAR))).toEqual([0, 1, 2, 3, 4, 5, 6, Calendar.KOREAN_LUNAR]);
  });
});
