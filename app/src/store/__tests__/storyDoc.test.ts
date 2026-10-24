import { describe, expect, it } from "vitest";
import { validate } from "@gramps-connect/story";
import { Calendar, Modifier, Quality } from "@gramps-connect/gramps-date";
import { parsePresentationMediaSrc, presentationDoc } from "../storyDoc";
import type { HydratedStory } from "../storyHydration";

const hydrated: HydratedStory = {
  title: "The Story of Josef Meyer",
  slides: [
    { title: "The Story of Josef Meyer", text: "3 moments.", photos: [{ ref: "portrait", mime: "image/jpeg" }] },
    {
      title: "Birth", text: "Born.", date: "about 1850", edtf: "1850~", year: 1850.4,
      placeTitle: "Zürich", lat: 47.37, long: 8.54, kmlMedia: ["mapfile"],
      nameDate: { modifier: Modifier.SPAN, quality: Quality.NONE, calendar: Calendar.GREGORIAN, dateval: [0, 0, 1840, false, 0, 0, 1860, false], text: "", newyear: 0 },
      mapFiles: [{
        handle: "mapfile",
        features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [8.54, 47.37] } }],
        overlays: [{ imageHandle: "oldmap", corners: [[8.5, 47.39], [8.58, 47.39], [8.58, 47.36], [8.5, 47.36]], opacity: 0.7, order: 2 }],
      }],
      photos: [{ ref: "portrait", mime: "image/jpeg" }],
    },
    // A PDF "photo" isn't something a slide can show.
    { title: "Census", text: "Counted.", photos: [{ ref: "scan", mime: "application/pdf" }] },
  ],
};

describe("presentationDoc", () => {
  it("converts every slide, unfiltered, into a valid story document", () => {
    const doc = presentationDoc(hydrated);
    expect(doc.slides.map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
    expect(doc.presentation).toEqual({ basemap: "standard" });
    // Valid as story.json, apart from there being no zip to hold the files.
    expect(validate(doc).errors).toEqual([]);
  });

  it("keeps the place, its shapes and its dated overlays", () => {
    const birth = presentationDoc(hydrated).slides[1];
    expect(birth.date).toEqual({ text: "about 1850", edtf: "1850~", sortYear: 1850 });
    expect(birth.place).toMatchObject({
      name: "Zürich", lat: 47.37, lon: 8.54,
      geometry: { type: "FeatureCollection", features: [{ type: "Feature" }] },
      overlays: [{ media: "m2", opacity: 0.7, order: 2, date: { edtf: "1840/1860" } }],
    });
  });

  it("points media at tree handles, for the app's own resolver", () => {
    const doc = presentationDoc(hydrated);
    expect(doc.slides[0].media).toEqual([{ ref: "m1" }]);
    expect(doc.slides[1].media).toEqual([{ ref: "m1" }]);
    expect(doc.slides[2].media).toBeUndefined();
    expect(doc.media).toEqual({
      m1: { src: "photo/portrait", mime: "image/jpeg" },
      m2: { src: "overlay/oldmap", mime: "application/octet-stream" },
    });
    expect(parsePresentationMediaSrc("overlay/oldmap")).toEqual({ purpose: "overlay", handle: "oldmap" });
    expect(parsePresentationMediaSrc("media/m1.webp")).toBeNull();
  });

  it("shows a slide's photos in order, leaving out what isn't an image", () => {
    const doc = presentationDoc({
      title: "T",
      slides: [{ title: "T", text: "", photos: [{ ref: "b", mime: "image/png" }, { ref: "scan", mime: "application/pdf" }, { ref: "a", mime: "image/jpeg" }] }],
    });
    expect(doc.slides[0].media).toEqual([{ ref: "m1" }, { ref: "m2" }]);
    expect(doc.media.m1.src).toBe("photo/b");
    expect(doc.media.m2).toEqual({ src: "photo/a", mime: "image/jpeg" });
  });
});
