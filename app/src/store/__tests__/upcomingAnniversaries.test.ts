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
  it("steps a week at a time from today, ignoring the time of day", () => {
    expect(windowRange(0, new Date(2026, 10, 1, 23, 59))).toEqual({ start: NOV_1, end: new Date(2026, 10, 7) });
    expect(windowRange(1, NOV_1)).toEqual({ start: new Date(2026, 10, 8), end: new Date(2026, 10, 14) });
    expect(windowRange(-1, NOV_1)).toEqual({ start: new Date(2026, 9, 25), end: new Date(2026, 9, 31) });
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
  it("asks for the most recent, lists them soonest first, and labels each event", async () => {
    // Served most recent first: 2012, 1890, yearless.
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
    events.byHandle.set("e3", event("e3", [1, 11, 0, false], { participants: { people: [], families: [] } }));

    const win = await fetchAnniversaryWindow("tok", 3, 0, NOV_1);
    expect(win.items.map((i) => [i.viewKey, i.handle, i.typeLabel, i.who, i.daysUntil, i.years])).toEqual([
      ["person", "p1", "Birth", "Smith, Ann", 0, 136],
      ["event", "e3", "Birth", "", 0, null],
      ["family", "f1", "Marriage", "Smith, Bob & Cat Jones", 4, 14],
    ]);
    expect(win.more).toBe(17);
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
    expect([win.items, win.more]).toEqual([[], 0]);
  });

  describe("Only living", () => {
    const living = { name_display: "Alive", death: {} };
    const dead = { name_display: "Gone", death: { date: "1990-01-01" } };
    const person = (handle: string, p: Record<string, unknown>) =>
      ({ participants: { people: [{ role: "Primary", person: { handle, ...p } }], families: [] } });
    const family = (father: Record<string, unknown>, mother: Record<string, unknown>) =>
      ({ type: "Marriage", participants: { people: [], families: [{ role: "Family", family: { handle: "f", father, mother } }] } });

    it("keeps births of the living and marriages with both spouses living, in batches until full", async () => {
      fetchPage
        .mockResolvedValueOnce({ page: { items: ["b-alive", "b-dead", "m-alive", "m-widowed", "orphan"].map((handle) => ({ handle })), next_after: "c1" }, totalCount: null })
        .mockResolvedValueOnce({ page: { items: [{ handle: "b2" }, { handle: "b3" }], next_after: "c2" }, totalCount: null });
      events.byHandle.set("b-alive", event("b-alive", [2, 11, 1990, false], person("p1", living)));
      events.byHandle.set("b-dead", event("b-dead", [2, 11, 1900, false], person("p2", dead)));
      events.byHandle.set("m-alive", event("m-alive", [3, 11, 2012, false], family(living, living)));
      events.byHandle.set("m-widowed", event("m-widowed", [3, 11, 1960, false], family(dead, living)));
      events.byHandle.set("orphan", event("orphan", [4, 11, 1980, false], { participants: { people: [], families: [] } }));
      events.byHandle.set("b2", event("b2", [5, 11, 1970, false], person("p3", living)));
      events.byHandle.set("b3", event("b3", [6, 11, 1960, false], person("p4", living)));

      const win = await fetchAnniversaryWindow("tok", 3, 0, NOV_1, { onlyLiving: true });
      expect(win.items.map((i) => i.eventHandle)).toEqual(["b-alive", "m-alive", "b2"]);
      // Stopped with b3 and a further cursor unchecked: may be more.
      expect(win.more).toBeNull();
      expect(fetchPage.mock.calls[0][4]).toContain("type.value != EventType.DEATH");
      expect(fetchPage.mock.calls[0][3]).toBe(false); // no count needed
      // The first batch left the card short: the second continues from it.
      expect(fetchPage.mock.calls[1][2]).toBe("c1");
    });

    it("says none more once the whole week has been checked", async () => {
      fetchPage.mockResolvedValueOnce(page(["b-alive"], null));
      events.byHandle.set("b-alive", event("b-alive", [2, 11, 1990, false], person("p1", living)));
      const win = await fetchAnniversaryWindow("tok", 8, 0, NOV_1, { onlyLiving: true });
      expect([win.items.length, win.more]).toEqual([1, 0]);
      expect(fetchPage).toHaveBeenCalledTimes(1);
    });
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
