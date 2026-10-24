// Turns a stored StorySpec (mostly refs, not copied data -- see
// storyBuilder.ts's own doc comment) into the plain display data
// StoryView.tsx actually renders. Place/date/photo are fleshed out fresh
// every time a story is presented, against whatever the referenced
// Event/Place/Media currently look like -- so an edit to the underlying
// record shows up the next time the story is opened, without regenerating
// the note. A point's `text` is the exception: it's part of the stored
// spec, so it's used as-is.
import type { Feature } from "geojson";
import { toEdtf, type GrampsDate } from "@gramps-connect/gramps-date";
import { getToken } from "../auth/auth";
import type { OverlayCorners } from "@gramps-connect/story/map-edit";
import { fetchMediaInfo, pointPhotos, type MediaInfo, type StoryBasemap, type StoryPoint, type StorySpec } from "./storyBuilder";
import { loadCompleteVisualData, type VisualData } from "./visualData";

/** One of a place's map files (mapOverlays.ts), already fetched and
 * parsed: its drawable shapes and its image overlays. */
export interface HydratedMapFile {
  handle: string;
  features: Feature[];
  overlays: { imageHandle: string; corners: OverlayCorners; opacity: number; order: number }[];
}

export interface HydratedSlide {
  title: string;
  text: string;
  placeTitle?: string;
  lat?: number;
  long?: number;
  /** Handles of the place's attached KML media (see MapPlace.kmlMedia) --
   * resolved into `mapFiles` below, so the story player draws the same
   * shapes MapCanvas draws for this place on the tree-wide map. Undefined rather than empty when there
   * is no place at all, matching lat/long's own optionality. */
  kmlMedia?: string[];
  /** The place's own name.date -- what gates an image overlay attached to
   * it (storyDoc.ts carries it to the player as each overlay's date). Undefined whenever kmlMedia is, or when the place has no
   * dated name. */
  nameDate?: GrampsDate;
  date?: string;
  /** The event's date as EDTF, when it maps faithfully (edtf.ts). */
  edtf?: string;
  year?: number;
  /** The place's map files, resolved -- one entry per kmlMedia handle
   * that could be fetched. */
  mapFiles?: HydratedMapFile[];
  /** The slide's photos, in order, each with its media type (only an
   * image is shown -- see storyDoc.ts's slidePhotos) and the caption and
   * credit its Media object gives it (storyBuilder.ts's MediaInfo). */
  photos?: { ref: string; mime?: string; caption?: string; credit?: string }[];
}

export interface HydratedStory {
  title: string;
  /** The spec's own settings, as stored (see StorySpec). */
  language?: string;
  basemap?: StoryBasemap;
  slides: HydratedSlide[]; // index 0 is the opening card (the point with no eventRef)
}

/** A draft slide plus, for a place with no lat/long of its own but a KML
 * attachment (visualData.pendingKmlPlaces -- see visualData.ts), the handle
 * to resolve a position for once hydrateStory's second pass below fetches
 * it. Undefined once resolved (or for the ordinary, already-located case),
 * so it's dropped rather than surviving into the public HydratedSlide. */
interface DraftSlide extends Omit<HydratedSlide, "photos"> {
  pendingPlaceHandle?: string;
  photoRefs: string[];
}

/** A point's display fields -- `title`/`text` come straight from the stored
 * spec (storyBuilder.ts seeds both via storyText.ts, but any edit made
 * afterward sticks), while place/date/photo are derived the same way
 * storyBuilder.ts used to assemble them at generation time -- read from
 * the current cache instead of a snapshot frozen into the Note. A point
 * with no photos falls back to the opening card's first, matching every
 * point getting a face even when it has no photo of its own. The opening point (no
 * `eventRef`) has no event to derive a title/place/date from, so its
 * title falls back to the story's own title. */
function hydratePoint(point: StoryPoint, specTitle: string, visualData: VisualData, introMediaRef: string | undefined): DraftSlide {
  const record = point.eventRef ? visualData.eventsByHandle.get(point.eventRef) : undefined;
  const placeHandle = point.eventRef ? visualData.placeOfEvent.get(point.eventRef) : undefined;
  const place = placeHandle ? visualData.places.find((p) => p.handle === placeHandle) : undefined;
  // A place with a KML attachment but no lat/long of its own doesn't make it
  // into visualData.places at all (see PendingKmlPlace) -- still worth a
  // title/kmlMedia now, and a position once the second pass below resolves
  // one from the file itself.
  const pending = !place && placeHandle
    ? visualData.pendingKmlPlaces.find((p) => p.handle === placeHandle) : undefined;
  // The event's own place title (as of the event's date, per the display
  // settings -- see visualData.ts) when there is one.
  const placeTitle = record?.placeTitle || (place?.title ?? pending?.title);
  // A generated point carries its own seeded heading (storyText.ts's
  // momentTitle), which is what makes a family story's slides read "Birth
  // of Josef Meyer" rather than five cards all headed "Birth". Falling back
  // to the bare event type keeps every story generated before that field
  // existed rendering exactly as it did.
  const title = point.title || (point.eventRef ? (record?.type ?? "") : specTitle);
  return {
    title,
    text: point.text || (placeTitle ? `${title} at ${placeTitle}` : title),
    placeTitle,
    lat: place?.lat,
    long: place?.long,
    kmlMedia: place?.kmlMedia ?? pending?.kmlMedia,
    nameDate: place?.nameDate ?? pending?.nameDate,
    date: record?.dateText || undefined,
    edtf: toEdtf(record?.date),
    year: record?.year ?? undefined,
    photoRefs: pointPhotos(point).length > 0 ? pointPhotos(point) : introMediaRef ? [introMediaRef] : [],
    pendingPlaceHandle: pending?.handle,
  };
}

/** What hydrateStory fetched beyond the cached tree data, by handle, kept
 * between calls by a caller that hydrates the same story over and over
 * (StoryEditor's preview, on each change) so each file is fetched once. */
export interface HydrationCache {
  positions: Map<string, Promise<[number, number] | null>>;
  mapFiles: Map<string, Promise<HydratedMapFile>>;
  media: Map<string, Promise<MediaInfo>>;
}

export function hydrationCache(): HydrationCache {
  return { positions: new Map(), mapFiles: new Map(), media: new Map() };
}

/** `cache.<kind>.get(key)`, or `load()` stored there first; with no cache,
 * just `load()`. */
function cached<T>(cache: Map<string, Promise<T>> | undefined, key: string, load: () => Promise<T>): Promise<T> {
  if (!cache) return load();
  let value = cache.get(key);
  if (!value) {
    value = load();
    cache.set(key, value);
    // A failure isn't remembered: the next call tries again.
    value.catch(() => cache.delete(key));
  }
  return value;
}

export async function hydrateStory(spec: StorySpec, cache?: HydrationCache): Promise<HydratedStory> {
  const visualData = await loadCompleteVisualData();
  const introMediaRef = spec.points[0] ? pointPhotos(spec.points[0])[0] : undefined;
  const draftSlides: DraftSlide[] =
    spec.points.map((p) => hydratePoint(p, spec.title, visualData, introMediaRef));

  // Resolves each pending place's position from its own KML file -- the
  // same lookup useVisualData.ts's hook does for the tree-wide map, just as
  // a plain awaited call here since a story is hydrated once per open
  // rather than kept live against a changing cache. Dynamically imported:
  // both pull in @tmcw/togeojson, and storyHydration.ts is reached
  // from the main bundle (StoryView.tsx imports it directly) -- a story
  // with no such place should never pay for that parser.
  const pendingHandles = [...new Set(
    draftSlides.map((s) => s.pendingPlaceHandle).filter((h): h is string => Boolean(h)),
  )];
  if (pendingHandles.length > 0) {
    const [{ fetchAllKmlFeatures }, { kmlCenter }] = await Promise.all([import("./kmlMedia"), import("@gramps-connect/story/map-edit")]);
    const positions = new Map<string, [number, number] | null>();
    await Promise.all(pendingHandles.map(async (handle) => {
      const pending = visualData.pendingKmlPlaces.find((p) => p.handle === handle)!;
      positions.set(handle, await cached(cache?.positions, handle, async () => kmlCenter(await fetchAllKmlFeatures(pending.kmlMedia))));
    }));
    for (const slide of draftSlides) {
      if (!slide.pendingPlaceHandle) continue;
      const position = positions.get(slide.pendingPlaceHandle);
      if (position) [slide.lat, slide.long] = position;
    }
  }

  // Every map file's shapes and image overlays, up front, so whatever
  // presents or exports the story has them without fetching per slide.
  // Same dynamic import as above: a story with no map files never loads
  // the KML/GPX parser.
  const mapFileHandles = [...new Set(draftSlides.flatMap((s) => s.kmlMedia ?? []))];
  const mapFiles = new Map<string, HydratedMapFile>();
  if (mapFileHandles.length > 0) {
    const { fetchAllKmlFeatures, fetchAllKmlImageOverlays } = await import("./kmlMedia");
    await Promise.all(mapFileHandles.map(async (handle) => {
      mapFiles.set(handle, await cached(cache?.mapFiles, handle, async () => {
        const [features, overlays] = await Promise.all([
          fetchAllKmlFeatures([handle]), fetchAllKmlImageOverlays([handle]),
        ]);
        return {
          handle,
          features,
          overlays: overlays.map((o) => ({ imageHandle: o.imageHandle, corners: o.corners, opacity: o.opacity, order: o.order })),
        };
      }));
    }));
    for (const slide of draftSlides) {
      if (!slide.kmlMedia?.length) continue;
      slide.mapFiles = slide.kmlMedia.map((h) => mapFiles.get(h)).filter((f): f is HydratedMapFile => Boolean(f));
    }
  }

  const infoByRef = new Map<string, MediaInfo>();
  const refs = [...new Set(draftSlides.flatMap((s) => s.photoRefs))];
  if (refs.length > 0) {
    await Promise.all(refs.map(async (ref) => {
      infoByRef.set(ref, await cached(cache?.media, ref, async () => fetchMediaInfo(await getToken(), ref)));
    }));
  }

  return {
    title: spec.title,
    ...(spec.language ? { language: spec.language } : {}),
    ...(spec.basemap ? { basemap: spec.basemap } : {}),
    slides: draftSlides.map(({ pendingPlaceHandle: _pendingPlaceHandle, photoRefs, ...s }) => ({
      ...s,
      ...(photoRefs.length > 0 ? { photos: photoRefs.map((ref) => ({ ref, ...infoByRef.get(ref) })) } : {}),
    })),
  };
}
