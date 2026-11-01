import { describe, expect, it } from "vitest";
import { ageGroupOf, groupByAge } from "../ageGroups";

// Local-time construction throughout, matching ageGroups.ts's own
// calendar-day boundaries in the viewer's time zone.
const now = new Date(2026, 10, 15, 0, 10); // 15 Nov 2026, 00:10
const at = (day: number, hour = 12, minute = 0) => new Date(2026, 10, day, hour, minute).getTime() / 1000;

describe("ageGroupOf", () => {
  it("uses calendar days, not 24-hour windows", () => {
    expect(ageGroupOf(at(15, 0, 5), now)).toBe("today");
    expect(ageGroupOf(at(14, 23, 50), now)).toBe("yesterday");
    expect(ageGroupOf(at(14, 0, 0), now)).toBe("yesterday");
  });

  it("buckets older changes by week and month", () => {
    expect(ageGroupOf(at(13), now)).toBe("week");
    expect(ageGroupOf(at(9), now)).toBe("week");
    expect(ageGroupOf(at(8), now)).toBe("month");
    expect(ageGroupOf(new Date(2026, 9, 17, 12).getTime() / 1000, now)).toBe("month");
    expect(ageGroupOf(new Date(2026, 9, 16, 12).getTime() / 1000, now)).toBe("older");
    expect(ageGroupOf(0, now)).toBe("older");
  });
});

describe("groupByAge", () => {
  it("keeps the given order and makes one group per run", () => {
    const items = [at(15, 0, 9), at(15, 0, 1), at(14), at(10), at(1)];
    const groups = groupByAge(items, (x) => x, now);
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([
      ["today", 2],
      ["yesterday", 1],
      ["week", 1],
      ["month", 1],
    ]);
  });

  it("returns nothing for nothing", () => {
    expect(groupByAge([], (x: number) => x, now)).toEqual([]);
  });
});
