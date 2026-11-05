// Home's Anniversaries card (upcomingAnniversaries.ts), over mocked
// fetchPage/fetchObjectsByHandle.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPage = vi.fn();
vi.mock("../api", () => ({ fetchPage: (...args: unknown[]) => fetchPage(...args) }));

const events = vi.hoisted(() => ({ byHandle: new Map<string, Record<string, unknown>>() }));
const fetchObjectsByHandle = vi.fn(async (_token: string, _type: string, handles: string[]) =>
  new Map(handles.filter((h) => events.byHandle.has(h)).map((h) => [h, events.byHandle.get(h)!])));
vi.mock("../objectsByHandle", () => ({ fetchObjectsByHandle: (...args: [string, string, string[]]) => fetchObjectsByHandle(...args) }));
vi.mock("../../i18n/i18n", () => ({ getI18nSnapshot: () => ({ lang: "en" }) }));

const { anniversaryExpr, fetchAnniversaryPage, nextOccurrence, previousOccurrence, formatDaysUntil, formatYears } =
  await import("../upcomingAnniversaries");

function page(handles: string[], nextAfter: string | null = null) {
  return { page: { items: handles.map((handle) => ({ handle })), next_after: nextAfter }, totalCount: null };
}

function event(handle: string, dateval: (number | boolean)[], profile: Record<string, unknown>) {
  return { handle, date: { dateval }, profile: { type: "Birth", date: "x", ...profile } };
}

const NOV_1 = new Date(2026, 10, 1);

beforeEach(() => {
  fetchPage.mockReset();
  fetchObjectsByHandle.mockClear();
  events.byHandle = new Map();
});

describe("nextOccurrence", () => {
  it("counts days to this year's date, or next year's once it has passed", () => {
    expect(nextOccurrence(11, 1, NOV_1)).toEqual({ daysUntil: 0, year: 2026 });
    expect(nextOccurrence(11, 3, NOV_1)).toEqual({ daysUntil: 2, year: 2026 });
    expect(nextOccurrence(1, 1, NOV_1)).toEqual({ daysUntil: 61, year: 2027 });
    expect(nextOccurrence(10, 31, NOV_1)).toEqual({ daysUntil: 364, year: 2027 });
  });

  it("ignores the time of day, and counts across a daylight-saving change", () => {
    expect(nextOccurrence(11, 2, new Date(2026, 10, 1, 23, 59))).toEqual({ daysUntil: 1, year: 2026 });
    expect(nextOccurrence(4, 1, new Date(2026, 2, 1, 0, 30)).daysUntil).toBe(31);
  });
});

describe("previousOccurrence", () => {
  it("counts days back to this year's date, or last year's when it is still to come", () => {
    expect(previousOccurrence(10, 31, NOV_1)).toEqual({ daysUntil: -1, year: 2026 });
    expect(previousOccurrence(11, 1, NOV_1)).toEqual({ daysUntil: -365, year: 2025 });
    expect(previousOccurrence(12, 31, NOV_1)).toEqual({ daysUntil: -305, year: 2025 });
  });
});

describe("anniversaryExpr", () => {
  it("splits the year at today, and leaves out future-dated events", () => {
    expect(anniversaryExpr(11, 1, 2026, true)).toContain(
      "date.dateval[2] <= 2026 and (date.dateval[1] > 11 or (date.dateval[1] == 11 and date.dateval[0] >= 1))");
    expect(anniversaryExpr(11, 1, 2026, false)).toContain(
      "(date.dateval[1] < 11 or (date.dateval[1] == 11 and date.dateval[0] < 1))");
  });
});

describe("fetchAnniversaryPage", () => {
  it("labels each event with its participant, days away and years", async () => {
    fetchPage.mockResolvedValueOnce(page(["e1", "e2", "e3"]));
    events.byHandle.set("e1", event("e1", [1, 11, 1950, false], {
      participants: { people: [{ role: "Primary", person: { handle: "p1", name_display: "Smith, Ann" } }], families: [] },
    }));
    events.byHandle.set("e2", event("e2", [5, 11, 0, false], {
      type: "Marriage",
      participants: { people: [], families: [{ role: "Family", family: {
        handle: "f1", father: { name_display: "Smith, Bob" }, mother: { name_given: "Cat", name_surname: "Jones" },
      } }] },
    }));
    events.byHandle.set("e3", event("e3", [9, 11, 1900, false], { participants: { people: [], families: [] } }));

    const { items } = await fetchAnniversaryPage("tok", 3, false, null, NOV_1);
    expect(items.map((i) => [i.viewKey, i.handle, i.typeLabel, i.who, i.daysUntil, i.years])).toEqual([
      ["person", "p1", "Birth", "Smith, Ann", 0, 76],
      ["family", "f1", "Marriage", "Smith, Bob & Cat Jones", 4, null],
      ["event", "e3", "Birth", "", 8, 126],
    ]);
    // A full first page needs no wrap-around query.
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchObjectsByHandle).toHaveBeenCalledWith("tok", "event", ["e1", "e2", "e3"]);
  });

  it("wraps into January for the rest, asking only for what's missing", async () => {
    fetchPage.mockResolvedValueOnce(page(["dec"])).mockResolvedValueOnce(page(["jan"]));
    events.byHandle.set("dec", event("dec", [24, 12, 1990, false], {}));
    events.byHandle.set("jan", event("jan", [2, 1, 1990, false], {}));

    const { items, next } = await fetchAnniversaryPage("tok", 8, false, null, new Date(2026, 11, 20));
    expect(items.map((i) => [i.eventHandle, i.daysUntil, i.years])).toEqual([["dec", 4, 36], ["jan", 13, 37]]);
    // Both segments ran out: a full year covered, nothing further.
    expect(next).toBeNull();
    expect(fetchPage.mock.calls[0][4]).toContain("date.dateval[0] >= 20");
    expect(fetchPage.mock.calls[1][4]).toContain("date.dateval[0] < 20");
    expect(fetchPage.mock.calls[0][6]).toBe(8);
    expect(fetchPage.mock.calls[1][6]).toBe(7);
  });

  it("continues from the cursor, within a segment and across into the next", async () => {
    fetchPage.mockResolvedValueOnce(page(["a", "b"], "cur1"));
    events.byHandle.set("a", event("a", [2, 11, 1990, false], {}));
    events.byHandle.set("b", event("b", [3, 11, 1990, false], {}));
    const first = await fetchAnniversaryPage("tok", 2, false, null, NOV_1);
    expect(first.next).toEqual({ segment: 0, after: "cur1" });

    // The rest of the year has one more, then January fills the page.
    fetchPage.mockResolvedValueOnce(page(["c"])).mockResolvedValueOnce(page(["d"], "cur2"));
    events.byHandle.set("c", event("c", [4, 12, 1990, false], {}));
    events.byHandle.set("d", event("d", [5, 1, 1990, false], {}));
    const second = await fetchAnniversaryPage("tok", 2, false, first.next, NOV_1);
    expect(second.items.map((i) => i.eventHandle)).toEqual(["c", "d"]);
    expect(fetchPage.mock.calls[1][2]).toBe("cur1");
    expect(fetchPage.mock.calls[2][2]).toBeNull();
    expect(fetchPage.mock.calls[2][4]).toContain("date.dateval[0] < 1");
    expect(second.next).toEqual({ segment: 1, after: "cur2" });
  });

  it("pages back from yesterday, showing each page earliest first", async () => {
    // Served nearest-first: yesterday, then 20 October; then last December.
    fetchPage.mockResolvedValueOnce(page(["oct31", "oct20"])).mockResolvedValueOnce(page(["dec"], "cur"));
    events.byHandle.set("oct31", event("oct31", [31, 10, 1950, false], {}));
    events.byHandle.set("oct20", event("oct20", [20, 10, 0, false], {}));
    events.byHandle.set("dec", event("dec", [25, 12, 1900, false], {}));

    const { items, next } = await fetchAnniversaryPage("tok", 3, true, null, NOV_1);
    expect(items.map((i) => [i.eventHandle, i.daysUntil, i.years])).toEqual([
      ["dec", -311, 125], ["oct20", -12, null], ["oct31", -1, 76],
    ]);
    // Before today this year, then today on, dated last year at the latest.
    expect(fetchPage.mock.calls[0][4]).toContain("date.dateval[2] <= 2026 and (date.dateval[1] < 11");
    expect(fetchPage.mock.calls[1][4]).toContain("date.dateval[2] <= 2025 and (date.dateval[1] > 11");
    expect(fetchPage.mock.calls[0][5].map((o: { direction: string }) => o.direction)).toEqual(["desc", "desc", "asc"]);
    expect(next).toEqual({ segment: 1, after: "cur" });
  });

  it("shows an empty card rather than failing", async () => {
    fetchPage.mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchAnniversaryPage("tok", 8, false, null, NOV_1)).toEqual({ items: [], next: null });
  });
});

describe("formatting", () => {
  it("says today/tomorrow/in N days, and N years", () => {
    expect(formatDaysUntil(0)).toBe("today");
    expect(formatDaysUntil(1)).toBe("tomorrow");
    expect(formatDaysUntil(5)).toBe("in 5 days");
    expect(formatDaysUntil(-1)).toBe("yesterday");
    expect(formatDaysUntil(-5)).toBe("5 days ago");
    expect(formatYears(150)).toBe("150 years");
  });
});
