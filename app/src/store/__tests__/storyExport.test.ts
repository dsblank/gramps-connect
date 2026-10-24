import { describe, expect, it } from "vitest";
import { readStoryZip } from "@gramps-connect/story";
import { Calendar, Modifier, Quality } from "@gramps-connect/gramps-date";
import {
  buildStoryZip,
  planStoryExport,
  storyFileName,
  type ExportOptions,
  type ExportPerson,
  type ExportSlide,
  type ImageLoader,
  type StoryExportSource,
} from "../storyExport";

const STRICT: ExportOptions = { includePrivate: false, includeLiving: false, includeIds: false };
const OPEN: ExportOptions = { includePrivate: true, includeLiving: true, includeIds: false };
const META = { language: "en", appVersion: "9.9.9", created: "2026-10-22T12:00:00.000Z" };

function person(handle: string, name: string, extra: Partial<ExportPerson> = {}): [string, ExportPerson] {
  return [handle, { handle, name, private: false, living: false, ...extra }];
}

function slide(title: string, extra: Omit<Partial<ExportSlide>, "hydrated"> & { hydrated?: Partial<ExportSlide["hydrated"]> } = {}): ExportSlide {
  const { hydrated, ...rest } = extra;
  return {
    hydrated: { title, text: `${title}.`, ...hydrated },
    event: { grampsId: `E-${title}`, private: false, placePrivate: false },
    people: ["josef"],
    ...rest,
  };
}

/** A person story about Josef (dead) with his wife Anna (living), a
 * private christening, a photo of the two of them, and a place with a map
 * file holding one shape and one image overlay. */
function source(): StoryExportSource {
  return {
    title: "The Story of Josef Meyer",
    noteGrampsId: "N0001",
    notePrivate: false,
    subjects: ["josef"],
    slides: [
      { hydrated: { title: "The Story of Josef Meyer", text: "4 moments.", photos: [{ ref: "portrait", mime: "image/jpeg" }] }, people: [] },
      slide("Birth", {
        hydrated: {
          date: "about 1850", edtf: "1850~", year: 1850.4, placeTitle: "Zürich", lat: 47.37, long: 8.54,
          kmlMedia: ["mapfile"], photos: [{ ref: "portrait", mime: "image/jpeg" }],
          mapFiles: [{
            handle: "mapfile",
            features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [8.54, 47.37] } }],
            overlays: [{ imageHandle: "oldmap", corners: [[8.5, 47.39], [8.58, 47.39], [8.58, 47.36], [8.5, 47.36]], opacity: 0.7, order: 0 }],
          }],
          nameDate: { modifier: Modifier.SPAN, quality: Quality.NONE, calendar: Calendar.GREGORIAN, dateval: [0, 0, 1840, false, 0, 0, 1860, false], text: "", newyear: 0 },
        },
        event: { grampsId: "E0001", private: false, placePrivate: false },
      }),
      slide("Christening", { event: { grampsId: "E0002", private: true, placePrivate: false } }),
      slide("Marriage", { people: ["josef", "anna"], hydrated: { photos: [{ ref: "couple", mime: "image/jpeg" }] } }),
      slide("Emigration", {
        hydrated: { placeTitle: "Secret Harbor", lat: 49.49, long: 0.1, photos: [{ ref: "ship", mime: "image/jpeg" }] },
        event: { grampsId: "E0004", private: false, placePrivate: true },
      }),
    ],
    people: new Map([person("josef", "Josef Meyer"), person("anna", "Anna Keller", { living: true })]),
    media: new Map([
      ["portrait", { handle: "portrait", grampsId: "O1", mime: "image/jpeg", private: false, desc: "Josef, about 1880", personHandles: ["josef"] }],
      ["couple", { handle: "couple", grampsId: "O2", mime: "image/jpeg", private: false, desc: "", personHandles: ["josef", "anna"] }],
      ["ship", { handle: "ship", grampsId: "O3", mime: "image/jpeg", private: true, desc: "", personHandles: [] }],
      ["oldmap", { handle: "oldmap", grampsId: "O4", mime: "image/png", private: false, desc: "", personHandles: [] }],
    ]),
    mapFiles: new Map([["mapfile", { handle: "mapfile", private: false }]]),
  };
}

/** Stands in for fetch + optimizeImage: a few bytes per image, PNG for
 * overlays and WebP for photos, like the real thing. */
const fakeImages: ImageLoader = async (media) => ({
  blob: new Blob([new Uint8Array([1, 2, 3, media.key.length])]),
  mime: media.purpose === "overlay" ? "image/png" : "image/webp",
  ext: media.purpose === "overlay" ? "png" : "webp",
  width: 100,
  height: 80,
});

describe("planStoryExport", () => {
  it("keeps everything when both switches are on", () => {
    const plan = planStoryExport(source(), OPEN, META);
    expect(plan.blocked).toBeNull();
    expect(plan.doc.slides.map((s) => s.title)).toEqual(["The Story of Josef Meyer", "Birth", "Christening", "Marriage", "Emigration"]);
    expect(plan.summary).toEqual({ slides: 5, slidesLeftOut: 0, photos: 3, photosLeftOut: 0, placesLeftOut: 0, overlaysLeftOut: 0 });
  });

  it("drops private events, slides about the living, and their photos", () => {
    const plan = planStoryExport(source(), STRICT, META);
    expect(plan.blocked).toBeNull();
    expect(plan.doc.slides.map((s) => s.title)).toEqual(["The Story of Josef Meyer", "Birth", "Emigration"]);
    // Slide ids are renumbered, so a gap can't reveal that something was left out.
    expect(plan.doc.slides.map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
    expect(plan.summary).toEqual({ slides: 3, slidesLeftOut: 2, photos: 1, photosLeftOut: 1, placesLeftOut: 1, overlaysLeftOut: 0 });
    // The private place goes, the slide stays -- and so does its private photo.
    const emigration = plan.doc.slides[2];
    expect(emigration.place).toBeUndefined();
    expect(emigration.media).toBeUndefined();
  });

  it("drops a photo of a living person even on a slide that stays", () => {
    const s = source();
    s.slides[3].people = ["josef"];
    const plan = planStoryExport(s, STRICT, META);
    const marriage = plan.doc.slides.find((x) => x.title === "Marriage")!;
    expect(marriage.media).toBeUndefined();
    expect(plan.summary.photosLeftOut).toBe(2); // the couple photo and the private ship
  });

  it("keeps a slide's other photos when one of them is left out", () => {
    const s = source();
    s.slides[1].hydrated.photos = [{ ref: "portrait", mime: "image/jpeg" }, { ref: "ship", mime: "image/jpeg" }, { ref: "oldmap", mime: "image/png" }];
    const plan = planStoryExport(s, STRICT, META);
    const birth = plan.doc.slides[1];
    // The private ship goes; the portrait and the map scan stay, in order.
    expect(birth.media?.map((m) => plan.media.find((x) => x.key === m.ref)?.handle)).toEqual(["portrait", "oldmap"]);
  });

  it("writes dates, places, geometry and dated overlays", () => {
    const plan = planStoryExport(source(), OPEN, META);
    const birth = plan.doc.slides[1];
    expect(birth.date).toEqual({ text: "about 1850", edtf: "1850~", sortYear: 1850 });
    expect(birth.place?.name).toBe("Zürich");
    expect([birth.place?.lat, birth.place?.lon]).toEqual([47.37, 8.54]);
    expect(birth.place?.geometry).toMatchObject({ type: "FeatureCollection", features: [{ type: "Feature" }] });
    expect(birth.place?.overlays).toEqual([{
      media: "m2",
      corners: [[8.5, 47.39], [8.58, 47.39], [8.58, 47.36], [8.5, 47.36]],
      opacity: 0.7,
      order: 0,
      date: { text: expect.any(String), edtf: "1840/1860" },
    }]);
    expect(plan.media.find((m) => m.key === "m2")).toEqual({ key: "m2", handle: "oldmap", purpose: "overlay" });
  });

  it("leaves out a private map file's shapes and overlays", () => {
    const s = source();
    s.mapFiles.get("mapfile")!.private = true;
    const birth = planStoryExport(s, STRICT, META).doc.slides[1];
    expect(birth.place?.geometry).toBeUndefined();
    expect(birth.place?.overlays).toBeUndefined();
    expect(birth.place?.name).toBe("Zürich");
    expect(planStoryExport(s, OPEN, META).doc.slides[1].place?.overlays).toHaveLength(1);
  });

  it("stores a photo used on several slides once, with its description as alt text", () => {
    const plan = planStoryExport(source(), OPEN, META);
    expect(plan.doc.slides[0].media).toEqual([{ ref: "m1" }]);
    expect(plan.doc.slides[1].media).toEqual([{ ref: "m1" }]);
    expect(plan.media.filter((m) => m.handle === "portrait")).toEqual([{ key: "m1", handle: "portrait", purpose: "photo", alt: "Josef, about 1880" }]);
  });

  it("names the people a slide is about", () => {
    const plan = planStoryExport(source(), OPEN, META);
    expect(plan.doc.slides[0].people).toEqual([{ name: "Josef Meyer" }]);
    expect(plan.doc.slides[3].people).toEqual([{ name: "Josef Meyer" }, { name: "Anna Keller" }]);
  });

  it("blocks a story about a living person, or a private story", () => {
    const s = source();
    s.people.get("josef")!.living = true;
    expect(planStoryExport(s, STRICT, META).blocked).toMatch(/living/);
    expect(planStoryExport(s, { ...STRICT, includeLiving: true }, META).blocked).toBeNull();

    const p = source();
    p.notePrivate = true;
    expect(planStoryExport(p, STRICT, META).blocked).toMatch(/private/);
    expect(planStoryExport(p, { ...STRICT, includePrivate: true }, META).blocked).toBeNull();
  });

  it("treats someone it couldn't look up as hidden", () => {
    const s = source();
    s.people.delete("josef");
    expect(planStoryExport(s, STRICT, META).blocked).not.toBeNull();
    expect(planStoryExport(s, OPEN, META).blocked).toBeNull();
  });

  it("writes Gramps IDs only when asked", () => {
    expect(planStoryExport(source(), OPEN, META).doc.extensions).toBeUndefined();
    const plan = planStoryExport(source(), { ...STRICT, includeIds: true }, META);
    expect(plan.doc.extensions).toEqual({
      "gramps-connect": {
        story: "N0001",
        slides: { s1: { event: "E0001" }, s2: { event: "E0004" } },
        media: { m1: "O1", m2: "O4" },
      },
    });
  });

  it("fills in the story's metadata", () => {
    const plan = planStoryExport(source(), OPEN, { language: "de_AT", appVersion: "1.2.3", created: META.created });
    expect(plan.doc).toMatchObject({
      format: "gramps-connect-story",
      version: "1.0",
      language: "de-AT",
      created: META.created,
      generator: { name: "Gramps Connect", version: "1.2.3" },
    });
    expect(plan.doc.presentation).toEqual({ basemap: "auto" });
  });

  it("uses the story's own language and map over the app's", () => {
    const plan = planStoryExport({ ...source(), language: "fr-CA", basemap: "historical" }, OPEN, META);
    expect(plan.doc.language).toBe("fr-CA");
    expect(plan.doc.presentation).toEqual({ basemap: "historical" });
    // Something that isn't a language tag falls back to the app's.
    expect(planStoryExport({ ...source(), language: "French!" }, OPEN, META).doc.language).toBe("en");
  });
});

describe("buildStoryZip", () => {
  it("writes a zip the format package reads back as valid", async () => {
    const plan = planStoryExport(source(), { ...OPEN, includeIds: true }, META);
    const progress: [number, number][] = [];
    const built = await buildStoryZip(plan, fakeImages, (done, total) => progress.push([done, total]));
    expect(built.fileName).toBe("The Story of Josef Meyer.story.zip");
    expect(built.failedImages).toBe(0);
    expect(progress[progress.length - 1]).toEqual([4, 4]);

    const pkg = await readStoryZip(built.zip);
    expect(pkg.warnings).toEqual([]);
    expect(pkg.doc.slides).toHaveLength(5);
    expect(pkg.doc.media.m1).toEqual({ src: "media/m1.webp", mime: "image/webp", width: 100, height: 80, alt: "Josef, about 1880" });
    expect(pkg.doc.media.m2).toMatchObject({ src: "media/m2.png", mime: "image/png" });
    expect([...pkg.files.keys()].sort()).toEqual(["media/m1.webp", "media/m2.png", "media/m3.webp", "media/m4.webp", "story.json"]);
  });

  it("leaves out an image it couldn't load, without leaving a dangling reference", async () => {
    const plan = planStoryExport(source(), { ...OPEN, includeIds: true }, META);
    const failOverlay: ImageLoader = async (m) => (m.handle === "oldmap" ? null : fakeImages(m));
    const built = await buildStoryZip(plan, failOverlay);
    expect(built.failedImages).toBe(1);
    const pkg = await readStoryZip(built.zip);
    expect(pkg.doc.slides[1].place?.overlays).toBeUndefined();
    expect(pkg.doc.extensions?.["gramps-connect"].media).toEqual({ m1: "O1", m3: "O2", m4: "O3" });
    // The plan itself is untouched, so downloading again starts clean.
    expect(plan.doc.extensions?.["gramps-connect"].media).toEqual({ m1: "O1", m2: "O4", m3: "O2", m4: "O3" });
    expect(plan.doc.slides[1].place?.overlays).toHaveLength(1);
  });

  it("refuses a blocked plan", async () => {
    const s = source();
    s.notePrivate = true;
    await expect(buildStoryZip(planStoryExport(s, STRICT, META), fakeImages)).rejects.toThrow(/private/);
  });
});

describe("storyFileName", () => {
  it("drops characters file systems refuse", () => {
    expect(storyFileName('A/B: "C"?')).toBe("A B C.story.zip");
    expect(storyFileName("   ")).toBe("story.story.zip");
  });
});
