import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/auth", () => ({ getToken: vi.fn(async () => "tok") }));
vi.mock("../storyHydration", () => ({
  hydrateStory: vi.fn(async (spec: { title: string; points: unknown[] }) => ({
    title: spec.title,
    slides: spec.points.map((_, i) => (i === 2
      ? { title: "Marriage", text: "", kmlMedia: ["mapfile"] }
      : { title: `Slide ${i}`, text: "", mediaRef: i === 0 ? "portrait" : undefined, mediaMime: i === 0 ? "image/jpeg" : undefined })),
  })),
}));
vi.mock("../kmlMedia", () => ({
  fetchAllKmlFeatures: vi.fn(async () => [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } }]),
  fetchAllKmlImageOverlays: vi.fn(async () => [{
    imageHandle: "oldmap", corners: [[0, 1], [1, 1], [1, 0], [0, 0]], opacity: 0.5, order: 3, kmlHandle: "mapfile", indexInFile: 0,
  }]),
}));

import { gatherStoryExport } from "../storyExport";
import type { ObjectDetail } from "../objectDetail";

const person = (handle: string, given: string, refs: { ref: string; role: unknown }[] = [], extra = {}) => ({
  handle, private: false, primary_name: { first_name: given, surname_list: [{ surname: "Meyer" }] }, event_ref_list: refs, ...extra,
});

/** What gramps-web-api answers, keyed by path (query string included). */
const API: Record<string, unknown> = {
  // Birth: Josef is Primary; the priest is only Clergy.
  "/api/events/birth?backlinks=1&extend=backlinks": {
    gramps_id: "E1", private: false, place: "zurich", date: { modifier: 0 },
    extended: { backlinks: { person: [
      person("josef", "Josef", [{ ref: "birth", role: "Primary" }]),
      person("priest", "Father Brown", [{ ref: "birth", role: "Clergy" }]),
    ] } },
  },
  // Marriage: a family event -- both spouses, neither sent as a Person.
  "/api/events/marriage?backlinks=1&extend=backlinks": {
    gramps_id: "E2", private: true, place: "",
    extended: { backlinks: { family: [{ handle: "fam", father_handle: "josef", mother_handle: "anna" }] } },
  },
  "/api/places/zurich": { private: true },
  "/api/media/portrait?backlinks=1": { gramps_id: "O1", mime: "image/jpeg", private: false, desc: "Portrait", backlinks: { person: ["josef"] } },
  "/api/media/mapfile?backlinks=1": { gramps_id: "O2", mime: "application/geo+json", private: true, backlinks: { person: null } },
  "/api/media/oldmap?backlinks=1": { gramps_id: "O3", mime: "image/png", private: false, desc: "", backlinks: { person: null } },
  "/api/people/anna": person("anna", "Anna", [], { private: true }),
  "/api/living/josef": { living: false },
  "/api/living/anna": { living: true },
};

const requested: string[] = [];
function stubApi() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    requested.push(path);
    if (path in API) return new Response(JSON.stringify(API[path]), { status: 200 });
    return new Response("{}", { status: 404 });
  }));
}
afterEach(() => {
  vi.unstubAllGlobals();
  requested.length = 0;
});

const note = {
  handle: "note", gramps_id: "N7", private: false,
  extended: { backlinks: { person: [person("josef", "Josef")] } },
} as unknown as ObjectDetail;

const spec = {
  title: "The Story of Josef Meyer",
  points: [{ mediaRef: "portrait" }, { eventRef: "birth" }, { eventRef: "marriage" }, { eventRef: "gone" }],
};

describe("gatherStoryExport", () => {
  it("collects who each slide is about, and every privacy fact", async () => {
    stubApi();
    const source = await gatherStoryExport(note, spec);

    expect(source.subjects).toEqual(["josef"]);
    expect(source.noteGrampsId).toBe("N7");
    // Subject roles only -- not the priest; both spouses for a family event.
    expect(source.slides.map((s) => s.people)).toEqual([[], ["josef"], ["josef", "anna"], []]);
    expect(source.slides[1].event).toEqual({ grampsId: "E1", private: false, date: { modifier: 0 }, placePrivate: true });
    expect(source.slides[2].event).toMatchObject({ grampsId: "E2", private: true, placePrivate: false });
    // A deleted event is simply absent.
    expect(source.slides[3].event).toBeUndefined();

    expect(source.people.get("josef")).toEqual({ handle: "josef", name: "Josef Meyer", private: false, living: false });
    expect(source.people.get("anna")).toEqual({ handle: "anna", name: "Anna Meyer", private: true, living: true });
    expect(source.people.has("priest")).toBe(false);

    expect(source.media.get("portrait")).toMatchObject({ private: false, desc: "Portrait", personHandles: ["josef"] });
    expect(source.media.get("oldmap")).toMatchObject({ mime: "image/png", personHandles: [] });
    expect(source.mapFiles.get("mapfile")).toMatchObject({ private: true, overlays: [{ imageHandle: "oldmap", opacity: 0.5, order: 3 }] });
  });

  it("asks only for what backlinks didn't already send, once each", async () => {
    stubApi();
    await gatherStoryExport(note, spec);
    // Josef arrived inside backlinks; only Anna needed fetching.
    expect(requested.filter((p) => p.startsWith("/api/people/"))).toEqual(["/api/people/anna"]);
    expect(new Set(requested).size).toBe(requested.length);
  });

  it("fails rather than guessing when a privacy fact can't be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(gatherStoryExport(note, spec)).rejects.toThrow(/Couldn't check/);
  });
});
