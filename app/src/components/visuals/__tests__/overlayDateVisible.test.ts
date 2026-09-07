import { describe, expect, it } from "vitest";
import { Calendar, Modifier, Quality, type GrampsDate } from "@gramps-connect/gramps-date";
import { overlayDateVisible } from "../mapStyles";

function date(partial: Partial<GrampsDate> & { dateval: GrampsDate["dateval"] }): GrampsDate {
  return {
    modifier: Modifier.NONE,
    quality: Quality.NONE,
    calendar: Calendar.GREGORIAN,
    text: "",
    newyear: 0,
    ...partial,
  } as GrampsDate;
}

describe("overlayDateVisible", () => {
  it("is always visible with no date at all", () => {
    expect(overlayDateVisible(undefined, 1900)).toBe(true);
  });

  it("is always visible with no year context (standard mode)", () => {
    const d = date({ dateval: [0, 0, 1850, false], modifier: Modifier.RANGE, sortval: 0 });
    expect(overlayDateVisible(d, null)).toBe(true);
  });

  it("is always visible for a text-only date (nothing structured to compare)", () => {
    const d = date({ dateval: [0, 0, 0, false], modifier: Modifier.TEXTONLY, text: "sometime in the 1800s" });
    expect(overlayDateVisible(d, 1850)).toBe(true);
  });

  it("checks a plain single-year date exactly", () => {
    const d = date({ dateval: [0, 0, 1900, false] });
    expect(overlayDateVisible(d, 1900)).toBe(true);
    expect(overlayDateVisible(d, 1901)).toBe(false);
  });

  it("checks a range/span inclusively at both ends", () => {
    // gramps-date's compound dateval is [day,month,year,slash, day,month,year,slash]
    const d = date({
      dateval: [0, 0, 1850, false, 0, 0, 1900, false] as unknown as GrampsDate["dateval"],
      modifier: Modifier.RANGE,
    });
    expect(overlayDateVisible(d, 1849)).toBe(false);
    expect(overlayDateVisible(d, 1850)).toBe(true);
    expect(overlayDateVisible(d, 1875)).toBe(true);
    expect(overlayDateVisible(d, 1900)).toBe(true);
    expect(overlayDateVisible(d, 1901)).toBe(false);
  });

  it("treats Before/To as an open-ended upper bound", () => {
    const before = date({ dateval: [0, 0, 1900, false], modifier: Modifier.BEFORE });
    expect(overlayDateVisible(before, 1500)).toBe(true);
    expect(overlayDateVisible(before, 1900)).toBe(true);
    expect(overlayDateVisible(before, 1901)).toBe(false);
  });

  it("treats After/From as an open-ended lower bound", () => {
    const after = date({ dateval: [0, 0, 1900, false], modifier: Modifier.AFTER });
    expect(overlayDateVisible(after, 1899)).toBe(false);
    expect(overlayDateVisible(after, 1900)).toBe(true);
    expect(overlayDateVisible(after, 2000)).toBe(true);
  });
});
