import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFamilyStory } from "../storyBuilder";
import { EMPTY_VISUAL_DATA, type EventRecord, type VisualData } from "../visualData";
import type { ObjectDetail } from "../objectDetail";

/** Every media lookup buildFamilyStory can make goes through fetch (mime
 * per handle, media_list per place -- see makeMediaResolver). Nothing in
 * this fixture has a photo, so every one of them 404s, which is also the
 * shape a tree with no media at all really has. */
function stubNoMedia() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
}
afterEach(() => vi.unstubAllGlobals());

function event(handle: string, type: string, year: number | null, dateText = year ? String(year) : ""): EventRecord {
  return {
    handle, grampsId: handle.toUpperCase(), type, description: "", placeTitle: "",
    dateText, datePreposition: dateText ? "in" : "", year,
  };
}

const EVENTS: EventRecord[] = [
  event("m1", "Marriage", 1878),
  event("m2", "Divorce", null),
  event("f-b", "Birth", 1850),
  event("f-d", "Death", 1920),
  event("f-w", "Baptism", 1860), // Hans as witness at someone else's baptism
  event("m-b", "Birth", 1854),
  event("c1-b", "Birth", 1880),
  event("c2-b", "Birth", 1882),
  event("c2-d", "Death", 1882),
];

function visualData(): VisualData {
  return {
    ...EMPTY_VISUAL_DATA,
    eventsByHandle: new Map(EVENTS.map((e) => [e.handle, e])),
    placeOfEvent: new Map(),
  };
}

function person(handle: string, given: string, surname: string, eventRefs: { ref: string; role?: string }[]) {
  return {
    handle,
    primary_name: { first_name: given, surname_list: [{ surname }] },
    event_ref_list: eventRefs.map((r) => ({ role: "Primary", ...r })),
    media_list: [],
  };
}

/** The shape a `GET /api/families/<h>?extend=all&profile=all&backlinks=1`
 * actually returns: extended.father/mother are whole Person objects
 * (gramps-web-api's util.py adds them past get_extended_attributes),
 * extended.children is positional with child_ref_list, and the couple's own
 * event refs carry role "Family". */
function family(): ObjectDetail {
  const children = [
    person("c1", "Josef", "Meyer", [{ ref: "c1-b" }]),
    person("c2", "Marie", "Meyer", [{ ref: "c2-b" }, { ref: "c2-d" }]),
  ];
  return {
    handle: "fam1",
    event_ref_list: [{ ref: "m1", role: "Family" }, { ref: "m2", role: "Family" }],
    child_ref_list: children.map((c) => ({ ref: c.handle, frel: "Birth", mrel: "Birth" })),
    media_list: [],
    extended: {
      father: person("f", "Hans", "Meyer", [
        { ref: "f-b" }, { ref: "f-d" }, { ref: "f-w", role: "Witness" },
      ]),
      mother: person("m", "Anna", "Schmidt", [{ ref: "m-b" }]),
      children,
      events: [{ media_list: [] }, { media_list: [] }],
      media: [],
    } as unknown as Record<string, unknown[]>,
  };
}

describe("buildFamilyStory", () => {
  it("merges the couple's events with every member's births and deaths, in date order", async () => {
    stubNoMedia();
    const spec = (await buildFamilyStory("t", family(), visualData()))!;
    expect(spec.title).toBe("The Story of Hans Meyer & Anna Schmidt");
    // Index 0 is the opening card; the rest are dated, then the undated tail.
    expect(spec.points.map((p) => p.eventRef)).toEqual([
      undefined, "f-b", "m-b", "m1", "c1-b", "c2-b", "c2-d", "f-d", "m2",
    ]);
  });

  it("seeds every slide with a title and text -- none left empty", async () => {
    stubNoMedia();
    const spec = (await buildFamilyStory("t", family(), visualData()))!;
    for (const point of spec.points) {
      expect(point.title, JSON.stringify(point)).toBeTruthy();
      expect(point.text, JSON.stringify(point)).toBeTruthy();
    }
    expect(spec.points[0].text).toBe(
      "8 moments from the life of Hans Meyer & Anna Schmidt and their 2 children."
    );
    expect(spec.points.slice(1).map((p) => `${p.title} | ${p.text}`)).toEqual([
      "Birth of Hans Meyer | Hans Meyer was born in 1850.",
      "Birth of Anna Schmidt | Anna Schmidt was born in 1854.",
      "Marriage of Hans Meyer & Anna Schmidt | Hans Meyer and Anna Schmidt were married in 1878.",
      "Birth of Josef Meyer | Josef Meyer was born in 1880.",
      "Birth of Marie Meyer | Marie Meyer was born in 1882.",
      "Death of Marie Meyer | Marie Meyer died in 1882.",
      "Death of Hans Meyer | Hans Meyer died in 1920.",
      "Divorce of Hans Meyer & Anna Schmidt | Hans Meyer and Anna Schmidt were divorced.",
    ]);
  });

  it("leaves out an event a member only witnessed", async () => {
    stubNoMedia();
    const spec = (await buildFamilyStory("t", family(), visualData()))!;
    expect(spec.points.some((p) => p.eventRef === "f-w")).toBe(false);
  });

  it("still tells the story when a parent is missing", async () => {
    stubNoMedia();
    const detail = family();
    // What gramps-web-api answers for an unset father_handle -- an empty
    // object, not null.
    (detail.extended as Record<string, unknown>).father = {};
    const spec = (await buildFamilyStory("t", detail, visualData()))!;
    expect(spec.title).toBe("The Story of Anna Schmidt");
    expect(spec.points.some((p) => p.eventRef === "f-b")).toBe(false);
    // One spouse means no plural phrase to reach for, so the marriage falls
    // to the noun form rather than claiming "Anna Schmidt were married".
    expect(spec.points[2]).toMatchObject({
      eventRef: "m1",
      title: "Marriage of Anna Schmidt",
      text: "Marriage of Anna Schmidt in 1878.",
    });
  });

  it("returns null when nothing in the family has a cached event", async () => {
    stubNoMedia();
    const detail = family();
    detail.event_ref_list = [];
    (detail.extended as Record<string, unknown>).events = [];
    expect(await buildFamilyStory("t", detail, { ...EMPTY_VISUAL_DATA })).toBeNull();
  });
});
