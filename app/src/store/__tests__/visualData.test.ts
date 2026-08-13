import { beforeAll, describe, expect, it, vi } from "vitest";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { Calendar, Modifier, Quality, gregorianSdn, type GrampsDate } from "@gramps-connect/gramps-date";
import { EVENT_VIEW, PLACE_VIEW, formatEventType, visibleColumns, type ViewConfig } from "../views";

vi.mock("../api", () => ({ fetchPage: vi.fn(), fetchByHandle: vi.fn() }));
vi.mock("../../auth/auth", () => ({
  getToken: vi.fn().mockResolvedValue("test-token"),
  getTreeId: vi.fn().mockReturnValue(null),
  getCurrentUsername: vi.fn().mockReturnValue(null),
}));
const stores = new Map<string, ViewStore>();
vi.mock("../registry", () => ({
  getViewStore: (key: string) => {
    const store = stores.get(key);
    if (!store) throw new Error(`no test store registered for ${key}`);
    return store;
  },
}));

import { fetchPage } from "../api";
import { ViewStore } from "../viewStore";
import { dateToYear, readVisualData } from "../visualData";

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

describe("dateToYear", () => {
  it("places a full date fractionally through its year", () => {
    // 1 July 1900 -- a bit past halfway.
    const year = dateToYear(date({ dateval: [1, 7, 1900, false], sortval: gregorianSdn(1900, 7, 1) }))!;
    expect(year).toBeGreaterThan(1900.49);
    expect(year).toBeLessThan(1900.51);
  });

  it("puts 1 January at the very start of its year", () => {
    expect(dateToYear(date({ dateval: [1, 1, 1900, false], sortval: gregorianSdn(1900, 1, 1) }))).toBe(1900);
  });

  it("handles a leap year without drifting past the year's end", () => {
    const year = dateToYear(date({ dateval: [31, 12, 1900, false], sortval: gregorianSdn(1900, 12, 31) }))!;
    expect(year).toBeLessThan(1901);
    expect(year).toBeGreaterThan(1900.99);
  });

  it("claims no false precision for a year-only date", () => {
    expect(dateToYear(date({ dateval: [0, 0, 1900, false], sortval: 0 }))).toBe(1900);
  });

  it("puts a year-month date at the start of that month", () => {
    // Month 7 of 12 => 6/12 of the way in.
    expect(dateToYear(date({ dateval: [0, 7, 1900, false], sortval: 0 }))).toBeCloseTo(1900.5, 6);
  });

  it("normalizes a Julian date to the Gregorian instant it names", () => {
    // 1 Jan 1900 Julian is 14 Jan 1900 Gregorian -- so it lands *after* the
    // start of 1900, not exactly on it, which is the point of going via SDN.
    const julian = date({
      dateval: [1, 1, 1900, false],
      calendar: Calendar.JULIAN,
      sortval: gregorianSdn(1900, 1, 14),
    });
    const year = dateToYear(julian)!;
    expect(year).toBeGreaterThan(1900);
    expect(year).toBeLessThan(1900.05);
  });

  it("rejects an unset date -- there is no year 0 in Gramps' calendars", () => {
    expect(dateToYear(date({ dateval: [0, 0, 0, false], sortval: 0 }))).toBeNull();
  });

  it("rejects a text-only date, which names no year at all", () => {
    const textOnly = date({
      dateval: [0, 0, 0, false],
      modifier: Modifier.TEXTONLY,
      text: "sometime in the war",
    });
    expect(dateToYear(textOnly)).toBeNull();
  });

  it("uses the start of a range", () => {
    const range = date({
      dateval: [1, 1, 1900, false, 1, 1, 1910, false],
      modifier: Modifier.RANGE,
      sortval: gregorianSdn(1900, 1, 1),
    });
    expect(dateToYear(range)).toBe(1900);
  });

  it("falls back to the whole year when the wire date carried no sortval", () => {
    expect(dateToYear(date({ dateval: [15, 6, 1900, false] }))).toBeCloseTo(1900 + 5 / 12, 6);
  });
});

describe("formatEventType", () => {
  it("resolves a built-in type from its integer value, which is all the raw struct carries", () => {
    expect(formatEventType(JSON.stringify({ _class: "EventType", string: "", value: 12 }))).toBe("Birth");
    expect(formatEventType(JSON.stringify({ _class: "EventType", string: "", value: 13 }))).toBe("Death");
  });

  it("prefers a custom type's own name over the 'Custom' its value 0 maps to", () => {
    expect(formatEventType(JSON.stringify({ _class: "EventType", string: "LVG", value: 0 }))).toBe("LVG");
  });

  it("returns nothing for an unset type or an unrecognized value", () => {
    expect(formatEventType(null)).toBe("");
    expect(formatEventType(JSON.stringify({ string: "", value: 999 }))).toBe("");
  });
});

describe("visibleColumns", () => {
  it("omits a hidden column but keeps every other column's index into the full list", () => {
    const visible = visibleColumns(EVENT_VIEW);
    expect(visible.some(({ column }) => column.key === "place")).toBe(false);
    for (const { column, index } of visible) {
      expect(EVENT_VIEW.columns[index]).toBe(column);
    }
  });

  it("leaves a view with no hidden columns exactly as it is", () => {
    const view = { ...EVENT_VIEW, columns: EVENT_VIEW.columns.filter((c) => !c.hidden) };
    expect(visibleColumns(view).map(({ index }) => index)).toEqual(view.columns.map((_, i) => i));
  });
});

let sqlPromise: Promise<SqlJsStatic> | null = null;
function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) sqlPromise = initSqlJs();
  return sqlPromise;
}

type SeedItem = Record<string, unknown> & { handle: string };

async function register(view: ViewConfig, items: SeedItem[]): Promise<void> {
  vi.mocked(fetchPage).mockResolvedValueOnce({
    page: { items, next_after: null },
    totalCount: items.length,
  });
  const store = new ViewStore(view, getSql);
  await store.runQuery(null, false);
  stores.set(view.key, store);
}

/** Wales (no coordinates) > Cardiff > Roath, with one dated event at Roath,
 * one undated event at Cardiff, and one event with no place at all. */
beforeAll(async () => {
  await register(PLACE_VIEW, [
    { handle: "wales", gramps_id: "P1", title: "Wales", lat: "", long: "", enclosed_by: [] },
    {
      handle: "cardiff", gramps_id: "P2", title: "Cardiff", lat: "51.48", long: "-3.18",
      enclosed_by: [{ _class: "PlaceRef", ref: "wales" }],
    },
    {
      handle: "roath", gramps_id: "P3", title: "Roath", lat: "51.49", long: "-3.16",
      enclosed_by: [{ _class: "PlaceRef", ref: "cardiff" }],
    },
  ]);
  await register(EVENT_VIEW, [
    {
      handle: "e1", gramps_id: "E1", event_type: { string: "", value: 12 }, description: "",
      place_title: "Roath", place: "roath",
      date: { _class: "Date", dateval: [0, 0, 1900, false], modifier: 0, quality: 0, calendar: 0, sortval: 0, text: "", newyear: 0 },
    },
    // Undated: absent from `events`, but its place still counts.
    { handle: "e2", gramps_id: "E2", event_type: { string: "", value: 13 }, description: "", place_title: "Cardiff", place: "cardiff", date: null },
    // No place at all.
    { handle: "e3", gramps_id: "E3", event_type: { string: "", value: 21 }, description: "", place_title: "", place: null, date: null },
  ]);
});

describe("readVisualData indexes", () => {
  it("maps every event to its place, dated or not", () => {
    // The map half of a scope needs undated events too -- a person's
    // undated burial still has a location worth plotting.
    const { placeOfEvent, events } = readVisualData();
    expect(placeOfEvent.get("e1")).toBe("roath");
    expect(placeOfEvent.get("e2")).toBe("cardiff");
    expect(events.map((e) => e.handle)).toEqual(["e1"]);
  });

  it("leaves a placeless event out of the index rather than mapping it to nothing", () => {
    expect(readVisualData().placeOfEvent.has("e3")).toBe(false);
  });

  it("inverts that into events-by-place", () => {
    const { eventsByPlace } = readVisualData();
    expect(eventsByPlace.get("roath")).toEqual(["e1"]);
    expect(eventsByPlace.get("cardiff")).toEqual(["e2"]);
  });

  it("builds the containment tree from places that have no coordinates of their own", () => {
    // Wales is never plotted (no lat/long) but must still appear as
    // Cardiff's parent, or scoping to it would reach nothing beneath it.
    const { childPlaces, places } = readVisualData();
    expect(places.map((p) => p.handle).sort()).toEqual(["cardiff", "roath"]);
    expect(childPlaces.get("wales")).toEqual(["cardiff"]);
    expect(childPlaces.get("cardiff")).toEqual(["roath"]);
  });
});
