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
  date?: string;
  year?: number;
  mediaRef?: string;
  mediaMime?: string;
}

export interface HydratedStory {
  title: string;
  slides: HydratedSlide[]; // index 0 is the opening card (the point with no eventRef)
}

/** A point's display fields -- `text` comes straight from the stored spec
 * (storyBuilder.ts seeds it from the event's description, but any edit
 * made afterward sticks), while place/date/photo are derived the same way
 * storyBuilder.ts used to assemble them at generation time -- read from
 * the current cache instead of a snapshot frozen into the Note. `mediaRef`
 * falls back to the opening card's own photo, matching every point getting
 * a face even when it has no photo of its own. The opening point (no
 * `eventRef`) has no event to derive a title/place/date from, so its
 * title falls back to the story's own title. */
function hydratePoint(point: StoryPoint, specTitle: string, visualData: Awaited<ReturnType<typeof loadVisualData>>, introMediaRef: string | undefined): Omit<HydratedSlide, "mediaMime"> {
  const record = point.eventRef ? visualData.eventsByHandle.get(point.eventRef) : undefined;
  const placeHandle = point.eventRef ? visualData.placeOfEvent.get(point.eventRef) : undefined;
  const place = placeHandle ? visualData.places.find((p) => p.handle === placeHandle) : undefined;
  const title = point.eventRef ? (record?.type ?? "") : specTitle;
  return {
    title,
    text: point.text || (place?.title ? `${title} at ${place.title}` : title),
    placeTitle: place?.title,
    lat: place?.lat,
    long: place?.long,
    date: record?.dateText || undefined,
    year: record?.year ?? undefined,
    mediaRef: point.mediaRef ?? introMediaRef,
  };
}

export async function hydrateStory(spec: StorySpec): Promise<HydratedStory> {
  const visualData = await loadVisualData();
  const introMediaRef = spec.points[0]?.mediaRef;
  const draftSlides: Omit<HydratedSlide, "mediaMime">[] =
    spec.points.map((p) => hydratePoint(p, spec.title, visualData, introMediaRef));

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
    slides: draftSlides.map((s) => ({ ...s, mediaMime: s.mediaRef ? mimeByRef.get(s.mediaRef) : undefined })),
  };
}
