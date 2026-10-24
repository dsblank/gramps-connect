// A hydrated story (storyHydration.ts) as a story document -- the
// gramps-connect-stories format that @gramps-connect/story's player shows
// and a downloaded .story.zip holds. One conversion for both, so Present
// can't show anything a download couldn't carry: storyExport.ts filters
// first and then builds its slides here; presentationDoc() below builds
// every slide, unfiltered, for Present itself.
import type { MediaItem, Place, Slide, StoryDoc } from "@gramps-connect/story";
import { toEdtf } from "@gramps-connect/gramps-date";
import { formatDisplayDate } from "./placeIndex";
import type { HydratedMapFile, HydratedSlide, HydratedStory } from "./storyHydration";

export type MediaPurpose = "photo" | "overlay";

/** Assigns (and remembers) a media key for a tree media handle. */
export type MediaKeyFor = (handle: string, purpose: MediaPurpose) => string;

export interface SlideDocInput {
  id: string;
  hydrated: HydratedSlide;
  /** Map files to draw (already filtered by the caller). */
  mapFiles: HydratedMapFile[];
  /** Leave the place out entirely (a private place). */
  dropPlace?: boolean;
  /** Whether an overlay image may be shown; default all. */
  overlayAllowed?: (imageHandle: string) => boolean;
  /** The slide's photo handles, in order. */
  photos?: string[];
  /** Names of the people the slide is about. */
  people?: string[];
}

export interface SlideDocResult {
  slide: Slide;
  /** Whether a place was there to drop (for the download summary). */
  hadPlace: boolean;
  overlaysLeftOut: number;
}

export function slideToDoc(input: SlideDocInput, keyFor: MediaKeyFor): SlideDocResult {
  const h = input.hydrated;
  const slide: Slide = { id: input.id };
  if (h.title) slide.title = h.title;
  if (h.text) slide.text = h.text;
  if (h.date) {
    slide.date = {
      text: h.date,
      ...(h.edtf ? { edtf: h.edtf } : {}),
      ...(h.year != null ? { sortYear: Math.floor(h.year) } : {}),
    };
  }

  let overlaysLeftOut = 0;
  const hadPlace = Boolean(h.placeTitle || (h.lat != null && h.long != null) || (h.kmlMedia?.length ?? 0) > 0);
  if (hadPlace && !input.dropPlace) {
    const place: Place = {};
    if (h.placeTitle) place.name = h.placeTitle;
    if (h.lat != null && h.long != null) {
      place.lat = h.lat;
      place.lon = h.long;
    }
    const features = input.mapFiles.flatMap((f) => f.features);
    if (features.length > 0) place.geometry = { type: "FeatureCollection", features } as unknown as Place["geometry"];
    // An overlay's era is its place's own name date (see mapStyles.ts's
    // overlayDateVisible): the same for every overlay on this place.
    const dateText = formatDisplayDate(h.nameDate);
    const edtf = toEdtf(h.nameDate);
    const overlays: NonNullable<Place["overlays"]> = [];
    for (const file of input.mapFiles) {
      for (const o of file.overlays) {
        if (input.overlayAllowed && !input.overlayAllowed(o.imageHandle)) {
          overlaysLeftOut += 1;
          continue;
        }
        overlays.push({
          media: keyFor(o.imageHandle, "overlay"),
          corners: o.corners,
          opacity: o.opacity,
          order: o.order,
          ...(dateText ? { date: { text: dateText, ...(edtf ? { edtf } : {}) } } : {}),
        });
      }
    }
    if (overlays.length > 0) place.overlays = overlays;
    if (Object.keys(place).length > 0) slide.place = place;
  }

  if (input.photos?.length) slide.media = input.photos.map((photo) => ({ ref: keyFor(photo, "photo") }));
  if (input.people?.length) slide.people = input.people.map((name) => ({ name }));
  return { slide, hadPlace, overlaysLeftOut };
}

/** The photos a hydrated slide shows, in order: those that are images,
 * its own or the opening card's (storyHydration.ts's fallback, written out
 * explicitly here since the format has no fallback rule of its own). */
export function slidePhotos(h: HydratedSlide): string[] {
  return (h.photos ?? []).filter((p) => p.mime?.startsWith("image/")).map((p) => p.ref);
}

export interface MediaKeys {
  keyFor: MediaKeyFor;
  /** Every key handed out, in order, with what it stands for. */
  entries: () => { key: string; handle: string; purpose: MediaPurpose }[];
}

/** Keys m1, m2, ... in first-use order; a handle used both ways is sized
 * as an overlay, the larger. */
export function mediaKeys(): MediaKeys {
  const byHandle = new Map<string, { key: string; handle: string; purpose: MediaPurpose }>();
  return {
    keyFor(handle, purpose) {
      let entry = byHandle.get(handle);
      if (!entry) {
        entry = { key: `m${byHandle.size + 1}`, handle, purpose };
        byHandle.set(handle, entry);
      } else if (purpose === "overlay") {
        entry.purpose = "overlay";
      }
      return entry.key;
    },
    entries: () => [...byHandle.values()],
  };
}

/** Where a presentation document's media lives: not in a zip, but in the
 * tree, which the app's player host fetches (StoryView.tsx). */
export function presentationMediaSrc(handle: string, purpose: MediaPurpose): string {
  return `${purpose}/${handle}`;
}

export function parsePresentationMediaSrc(src: string): { handle: string; purpose: MediaPurpose } | null {
  const match = /^(photo|overlay)\/(.+)$/.exec(src);
  return match ? { purpose: match[1] as MediaPurpose, handle: match[2] } : null;
}

/** Every slide of a hydrated story, unfiltered, as a document for the
 * player -- what Present shows. Media `src`s name tree media handles
 * (presentationMediaSrc), not files. */
export function presentationDoc(hydrated: HydratedStory): StoryDoc {
  const keys = mediaKeys();
  const mimeByHandle = new Map<string, string>();
  const slides = hydrated.slides.map((h, i) => {
    for (const p of h.photos ?? []) if (p.mime?.startsWith("image/")) mimeByHandle.set(p.ref, p.mime);
    return slideToDoc({ id: `s${i}`, hydrated: h, mapFiles: h.mapFiles ?? [], photos: slidePhotos(h) }, keys.keyFor).slide;
  });
  const media: Record<string, MediaItem> = {};
  for (const { key, handle, purpose } of keys.entries()) {
    media[key] = { src: presentationMediaSrc(handle, purpose), mime: mimeByHandle.get(handle) ?? "application/octet-stream" };
  }
  return {
    format: "gramps-connect-story",
    version: "1.0",
    title: hydrated.title,
    // Present has always opened on the standard map.
    presentation: { basemap: "standard" },
    slides,
    media,
  };
}
