// Turns a stored StorySpec (mostly refs, not copied data -- see
// storyBuilder.ts's own doc comment) into the plain display data
// StoryView.tsx actually renders. Place/date/photo are fleshed out fresh
// every time a story is presented, against whatever the referenced
// Event/Place/Media currently look like -- so an edit to the underlying
// record shows up the next time the story is opened, without regenerating
// the note. A point's `text` is the exception: it's part of the stored
// spec, so it's used as-is.
import { getToken } from "../auth/auth";
import { fetchMediaMime, type StoryPoint, type StorySpec } from "./storyBuilder";
import { loadVisualData } from "./visualData";

export interface HydratedSlide {
  title: string;
  text: string;
  placeTitle?: string;
  lat?: number;
  long?: number;
  /** Handles of the place's attached KML media (see MapPlace.kmlMedia) --
   * what lets StoryMapBackground overlay the same shape MapCanvas draws for
   * this place on the tree-wide map. Undefined rather than empty when there
   * is no place at all, matching lat/long's own optionality. */
  kmlMedia?: string[];
  date?: string;
  year?: number;
  mediaRef?: string;
  mediaMime?: string;
}

export interface HydratedStory {
  title: string;
  slides: HydratedSlide[]; // index 0 is the opening card (the point with no eventRef)
}

/** A draft slide plus, for a place with no lat/long of its own but a KML
 * attachment (visualData.pendingKmlPlaces -- see visualData.ts), the handle
 * to resolve a position for once hydrateStory's second pass below fetches
 * it. Undefined once resolved (or for the ordinary, already-located case),
 * so it's dropped rather than surviving into the public HydratedSlide. */
interface DraftSlide extends Omit<HydratedSlide, "mediaMime"> {
  pendingPlaceHandle?: string;
}

/** A point's display fields -- `title`/`text` come straight from the stored
 * spec (storyBuilder.ts seeds both via storyText.ts, but any edit made
 * afterward sticks), while place/date/photo are derived the same way
 * storyBuilder.ts used to assemble them at generation time -- read from
 * the current cache instead of a snapshot frozen into the Note. `mediaRef`
 * falls back to the opening card's own photo, matching every point getting
 * a face even when it has no photo of its own. The opening point (no
 * `eventRef`) has no event to derive a title/place/date from, so its
 * title falls back to the story's own title. */
function hydratePoint(point: StoryPoint, specTitle: string, visualData: Awaited<ReturnType<typeof loadVisualData>>, introMediaRef: string | undefined): DraftSlide {
  const record = point.eventRef ? visualData.eventsByHandle.get(point.eventRef) : undefined;
  const placeHandle = point.eventRef ? visualData.placeOfEvent.get(point.eventRef) : undefined;
  const place = placeHandle ? visualData.places.find((p) => p.handle === placeHandle) : undefined;
  // A place with a KML attachment but no lat/long of its own doesn't make it
  // into visualData.places at all (see PendingKmlPlace) -- still worth a
  // title/kmlMedia now, and a position once the second pass below resolves
  // one from the file itself.
  const pending = !place && placeHandle
    ? visualData.pendingKmlPlaces.find((p) => p.handle === placeHandle) : undefined;
  const placeTitle = place?.title ?? pending?.title;
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
    date: record?.dateText || undefined,
    year: record?.year ?? undefined,
    mediaRef: point.mediaRef ?? introMediaRef,
    pendingPlaceHandle: pending?.handle,
  };
}

export async function hydrateStory(spec: StorySpec): Promise<HydratedStory> {
  const visualData = await loadVisualData();
  const introMediaRef = spec.points[0]?.mediaRef;
  const draftSlides: DraftSlide[] =
    spec.points.map((p) => hydratePoint(p, spec.title, visualData, introMediaRef));

  // Resolves each pending place's position from its own KML file -- the
  // same lookup useVisualData.ts's hook does for the tree-wide map, just as
  // a plain awaited call here since a story is hydrated once per open
  // rather than kept live against a changing cache. Dynamically imported:
  // kmlMedia.ts pulls in @tmcw/togeojson, and storyHydration.ts is reached
  // from the main bundle (StoryView.tsx imports it directly) -- a story
  // with no such place should never pay for that parser.
  const pendingHandles = [...new Set(
    draftSlides.map((s) => s.pendingPlaceHandle).filter((h): h is string => Boolean(h)),
  )];
  if (pendingHandles.length > 0) {
    const { fetchAllKmlFeatures, kmlCenter } = await import("./kmlMedia");
    const positions = new Map<string, [number, number] | null>();
    await Promise.all(pendingHandles.map(async (handle) => {
      const pending = visualData.pendingKmlPlaces.find((p) => p.handle === handle)!;
      positions.set(handle, kmlCenter(await fetchAllKmlFeatures(pending.kmlMedia)));
    }));
    for (const slide of draftSlides) {
      if (!slide.pendingPlaceHandle) continue;
      const position = positions.get(slide.pendingPlaceHandle);
      if (position) [slide.lat, slide.long] = position;
    }
  }

  const mimeByRef = new Map<string, string | undefined>();
  const refs = [...new Set(draftSlides.map((s) => s.mediaRef).filter((r): r is string => Boolean(r)))];
  if (refs.length > 0) {
    const token = await getToken();
    await Promise.all(refs.map(async (ref) => {
      mimeByRef.set(ref, await fetchMediaMime(token, ref));
    }));
  }

  return {
    title: spec.title,
    slides: draftSlides.map(({ pendingPlaceHandle: _pendingPlaceHandle, ...s }) => ({
      ...s, mediaMime: s.mediaRef ? mimeByRef.get(s.mediaRef) : undefined,
    })),
  };
}
