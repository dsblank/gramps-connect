import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFamilyStory, buildPersonStory, personDisplayName, pointPhotos, storyLanguageTag, withPhotos } from "../storyBuilder";
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
  // Record-keeping a GEDCOM import leaves behind as events.
  event("upd", "_UPD", null),
  event("refno", "Reference Number", null),
  // An undated standard event is still a moment.
  event("c1-bap", "Baptism", null),
];

function visualData(): VisualData {
  return {
    ...EMPTY_VISUAL_DATA,
    eventsByHandle: new Map(EVENTS.map((e) => [e.handle, e])),
    placeOfEvent: new Map(),
  };
}

function person(handle: string, given: string, surname: string, eventRefs: { ref: string; role?: string }[], gender?: number) {
  return {
    handle,
    ...(gender !== undefined ? { gender } : {}),
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
    person("c1", "Josef", "Meyer", [{ ref: "c1-b" }], 1),
    person("c2", "Marie", "Meyer", [{ ref: "c2-b" }, { ref: "c2-d" }], 0),
  ];
  return {
    handle: "fam1",
    event_ref_list: [{ ref: "m1", role: "Family" }, { ref: "m2", role: "Family" }],
    child_ref_list: children.map((c) => ({ ref: c.handle, frel: "Birth", mrel: "Birth" })),
    media_list: [],
    extended: {
      father: person("f", "Hans", "Meyer", [
        { ref: "f-b" }, { ref: "f-d" }, { ref: "f-w", role: "Witness" },
      ], 1),
      mother: person("m", "Anna", "Schmidt", [{ ref: "m-b" }], 0),
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
      "Birth of Josef Meyer | Their son, Josef Meyer, was born in 1880.",
      "Birth of Marie Meyer | Their daughter, Marie Meyer, was born in 1882.",
      "Death of Marie Meyer | Their daughter, Marie Meyer, died in 1882.",
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

/** Stands in for the API: the one family (for buildPersonStory's
 * includeFamilyEvents) and the media in `images`, each an image; anything
 * else 404s. */
function stubApi(images: string[] = []) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/api/families/fam1")) return { ok: true, json: async () => family() };
    const media = images.find((h) => url.includes(`/api/media/${h}`));
    if (media) return { ok: true, json: async () => ({ mime: "image/jpeg" }) };
    return { ok: false, json: async () => ({}) };
  }));
}

/** Josef, as a fetched Person: his own birth and baptism, two bookkeeping
 * "events", and the family he was born into. */
function josef(): ObjectDetail {
  const refs = [{ ref: "c1-b" }, { ref: "c1-bap" }, { ref: "upd" }, { ref: "refno" }];
  return {
    handle: "c1",
    gramps_id: "I0001",
    gender: 1,
    primary_name: { first_name: "Josef", suffix: "Jr", surname_list: [{ surname: "Meyer" }] },
    event_ref_list: refs.map((r) => ({ role: "Primary", ...r })),
    parent_family_list: ["fam1"],
    family_list: [],
    media_list: [],
    extended: { events: refs.map(() => ({ media_list: [] })), media: [] } as unknown as Record<string, unknown[]>,
  } as unknown as ObjectDetail;
}

describe("buildPersonStory", () => {
  it("names the person as a sentence would, never by their list label", async () => {
    stubApi();
    const spec = (await buildPersonStory("t", josef(), "[I0001] Meyer, Josef", visualData()))!;
    expect(spec.title).toBe("The Story of Josef Meyer Jr");
    expect(spec.points[0].text).toBe("2 moments from the life of Josef Meyer Jr (born 1880).");
  });

  it("leaves out record-keeping events but keeps an undated real one", async () => {
    stubApi();
    const spec = (await buildPersonStory("t", josef(), "Josef", visualData()))!;
    expect(spec.points.map((p) => p.eventRef)).toEqual([undefined, "c1-b", "c1-bap"]);
  });

  it("says how each relative is related", async () => {
    stubApi();
    const spec = (await buildPersonStory("t", josef(), "Josef", visualData(), { includeFamilyEvents: true }))!;
    const texts = spec.points.slice(1).map((p) => p.text);
    expect(texts).toEqual([
      "His father, Hans Meyer, was born in 1850.",
      "His mother, Anna Schmidt, was born in 1854.",
      "His parents, Hans Meyer and Anna Schmidt, were married in 1878.",
      "Josef Meyer Jr was born in 1880.",
      "His sister, Marie Meyer, was born in 1882.",
      "His sister, Marie Meyer, died in 1882.",
      "His father, Hans Meyer, died in 1920.",
      "Josef Meyer Jr was baptized.",
      "His parents, Hans Meyer and Anna Schmidt, were divorced.",
    ]);
  });
});

describe("photos on a couple's event", () => {
  it("shows both spouses' portraits", async () => {
    stubApi(["pf", "pm"]);
    const detail = family();
    const extended = detail.extended as unknown as { father: { media_list: unknown[] }; mother: { media_list: unknown[] } };
    extended.father.media_list = [{ ref: "pf" }];
    extended.mother.media_list = [{ ref: "pm" }];
    const spec = (await buildFamilyStory("t", detail, visualData()))!;
    const marriage = spec.points.find((p) => p.eventRef === "m1")!;
    expect(pointPhotos(marriage)).toEqual(["pf", "pm"]);
    // A spouse's own birth still shows just that spouse.
    expect(pointPhotos(spec.points.find((p) => p.eventRef === "m-b")!)).toEqual(["pm"]);
  });
});

describe("personDisplayName", () => {
  it("keeps a generational suffix but not a title stored as one", () => {
    const name = (suffix: string) => personDisplayName({
      primary_name: { first_name: "George VI", suffix, surname_list: [{ surname: "Windsor" }] },
    });
    expect(name("III")).toBe("George VI Windsor III");
    expect(name("Jr.")).toBe("George VI Windsor Jr.");
    expect(name("King of England")).toBe("George VI Windsor");
  });

  it("puts a surname's prefix in front of it", () => {
    expect(personDisplayName({ primary_name: { first_name: "Vincent", surname_list: [{ prefix: "van", surname: "Gogh" }] } }))
      .toBe("Vincent van Gogh");
  });
});

describe("a point's photos", () => {
  it("keeps the first in mediaRef, for copies of the app that only know one", () => {
    const point = withPhotos({ eventRef: "e", text: "t" }, ["a", "b", "c"]);
    expect(point).toEqual({ eventRef: "e", text: "t", mediaRef: "a", moreMediaRefs: ["b", "c"] });
    expect(pointPhotos(point)).toEqual(["a", "b", "c"]);
    expect(withPhotos(point, ["c"])).toEqual({ eventRef: "e", text: "t", mediaRef: "c" });
    expect(withPhotos(point, [])).toEqual({ eventRef: "e", text: "t" });
    expect(pointPhotos({ mediaRef: "only" })).toEqual(["only"]);
  });
});

describe("storyLanguageTag", () => {
  it("accepts a language code, in Gramps' own form too", () => {
    expect(storyLanguageTag("en")).toBe("en");
    expect(storyLanguageTag(" fr-CA ")).toBe("fr-CA");
    expect(storyLanguageTag("de_AT")).toBe("de-AT");
    expect(storyLanguageTag("zh-Hant-TW")).toBe("zh-Hant-TW");
  });

  it("leaves out what isn't one", () => {
    expect(storyLanguageTag(undefined)).toBeUndefined();
    expect(storyLanguageTag("")).toBeUndefined();
    expect(storyLanguageTag("   ")).toBeUndefined();
    expect(storyLanguageTag("e")).toBeUndefined();
    expect(storyLanguageTag("German!")).toBeUndefined();
    expect(storyLanguageTag("en-")).toBeUndefined();
    expect(storyLanguageTag("en US")).toBeUndefined();
  });
});
