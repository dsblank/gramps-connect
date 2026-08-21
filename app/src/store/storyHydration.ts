// Turns a stored StorySpec (all refs, no copied data -- see
// storyBuilder.ts's own doc comment) into the plain display data
// StoryView.tsx actually renders. This is where "flesh out the JSON with
// info the presenter needs" happens, every time a story is presented,
// against whatever the referenced Event/Place/Media currently look like --
// so an edit to the underlying record shows up the next time the story is
// opened, without regenerating the note.
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
  slides: HydratedSlide[]; // index 0 is the synthetic intro slide
}

/** A point's display fields, derived the same way storyBuilder.ts used to
 * assemble them at generation time -- just read from the current cache
 * instead of a snapshot frozen into the Note. `mediaRef` falls back to the
 * story's own intro photo, matching every point getting a face even when
 * it has no photo of its own. */
function hydratePoint(point: StoryPoint, visualData: Awaited<ReturnType<typeof loadVisualData>>, introMediaRef: string | undefined): Omit<HydratedSlide, "mediaMime"> {
  const record = point.eventRef ? visualData.eventsByHandle.get(point.eventRef) : undefined;
  const placeHandle = point.eventRef ? visualData.placeOfEvent.get(point.eventRef) : undefined;
  const place = placeHandle ? visualData.places.find((p) => p.handle === placeHandle) : undefined;
  const title = record?.type ?? "";
  return {
    title,
    text: record?.description || (place?.title ? `${title} at ${place.title}` : title),
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
  const draftSlides: Omit<HydratedSlide, "mediaMime">[] = [
    { title: spec.title, text: spec.intro, mediaRef: spec.introMediaRef },
    ...spec.points.map((p) => hydratePoint(p, visualData, spec.introMediaRef)),
  ];

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
