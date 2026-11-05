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

const { windowRange, windowExpr, occurrenceIn, fetchAnniversaryWindow, formatDaysUntil, formatYears, formatWindow } =
  await import("../upcomingAnniversaries");

function page(handles: string[], total: number | null = handles.length) {
  return { page: { items: handles.map((handle) => ({ handle })), next_after: null }, totalCount: total };
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

describe("windowRange", () => {
  it("steps 30 days at a time from today, ignoring the time of day", () => {
    expect(windowRange(0, new Date(2026, 10, 1, 23, 59))).toEqual({ start: NOV_1, end: new Date(2026, 10, 30) });
    expect(windowRange(1, NOV_1)).toEqual({ start: new Date(2026, 11, 1), end: new Date(2026, 11, 30) });
    expect(windowRange(-1, NOV_1)).toEqual({ start: new Date(2026, 9, 2), end: new Date(2026, 9, 31) });
  });
});

describe("windowExpr", () => {
  it("is one month/day range within a year", () => {
    expect(windowExpr(NOV_1, new Date(2026, 10, 30))).toContain(
      "((date.dateval[2] <= 2026 and (date.dateval[1] > 11 or (date.dateval[1] == 11 and date.dateval[0] >= 1))" +
      " and (date.dateval[1] < 11 or (date.dateval[1] == 11 and date.dateval[0] <= 30))))");
  });

  it("splits over New Year, each piece capped at its own year", () => {
    const expr = windowExpr(new Date(2026, 11, 20), new Date(2027, 0, 18));
    expect(expr).toContain("(date.dateval[2] <= 2026 and (date.dateval[1] > 12 or (date.dateval[1] == 12 and date.dateval[0] >= 20))");
    expect(expr).toContain(" or (date.dateval[2] <= 2027 and (date.dateval[1] > 1 or (date.dateval[1] == 1 and date.dateval[0] >= 1))");
  });
});

describe("occurrenceIn", () => {
  it("finds the day's date in the window, either side of New Year", () => {
    const start = new Date(2026, 11, 20), end = new Date(2027, 0, 18);
    expect(occurrenceIn(12, 24, start, end)).toEqual(new Date(2026, 11, 24));
    expect(occurrenceIn(1, 2, start, end)).toEqual(new Date(2027, 0, 2));
  });
});

describe("fetchAnniversaryWindow", () => {
  it("asks for the most recent first, and labels each event", async () => {
    fetchPage.mockResolvedValueOnce(page(["e1", "e2", "e3"], 20));
    events.byHandle.set("e1", event("e1", [5, 11, 2012, false], {
      type: "Marriage",
      participants: { people: [], families: [{ role: "Family", family: {
        handle: "f1", father: { name_display: "Smith, Bob" }, mother: { name_given: "Cat", name_surname: "Jones" },
      } }] },
    }));
    events.byHandle.set("e2", event("e2", [1, 11, 1890, false], {
      participants: { people: [{ role: "Primary", person: { handle: "p1", name_display: "Smith, Ann" } }], families: [] },
    }));
    events.byHandle.set("e3", event("e3", [9, 11, 0, false], { participants: { people: [], families: [] } }));

    const win = await fetchAnniversaryWindow("tok", 3, 0, NOV_1);
    expect(win.items.map((i) => [i.viewKey, i.handle, i.typeLabel, i.who, i.daysUntil, i.years])).toEqual([
      ["family", "f1", "Marriage", "Smith, Bob & Cat Jones", 4, 14],
      ["person", "p1", "Birth", "Smith, Ann", 0, 136],
      ["event", "e3", "Birth", "", 8, null],
    ]);
    expect(win.total).toBe(20);
    expect(fetchPage.mock.calls[0][3]).toBe(true); // wants the count
    expect(fetchPage.mock.calls[0][5][0]).toEqual({ column: "date.dateval[2]", direction: "desc" });
    expect(fetchPage.mock.calls[0][6]).toBe(3);
  });

  it("counts days back, and years as of then, in an earlier window", async () => {
    fetchPage.mockResolvedValueOnce(page(["oct31"]));
    events.byHandle.set("oct31", event("oct31", [31, 10, 1950, false], {}));
    const win = await fetchAnniversaryWindow("tok", 8, -1, NOV_1);
    expect(win.items.map((i) => [i.daysUntil, i.years])).toEqual([[-1, 76]]);
  });

  it("shows an empty card rather than failing", async () => {
    fetchPage.mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const win = await fetchAnniversaryWindow("tok", 8, 0, NOV_1);
    expect([win.items, win.total]).toEqual([[], null]);
  });
});

describe("formatting", () => {
  it("says today/tomorrow/in N days/N days ago, N years, and the window", () => {
    expect(formatDaysUntil(0)).toBe("today");
    expect(formatDaysUntil(1)).toBe("tomorrow");
    expect(formatDaysUntil(5)).toBe("in 5 days");
    expect(formatDaysUntil(-1)).toBe("yesterday");
    expect(formatDaysUntil(-5)).toBe("5 days ago");
    expect(formatYears(150)).toBe("150 years");
    expect(formatWindow(NOV_1, new Date(2026, 10, 30))).toMatch(/Nov 1\s*–\s*30/);
  });
});
