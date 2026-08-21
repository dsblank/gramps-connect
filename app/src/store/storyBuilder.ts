// Pilot: turns a Person's own events into a story spec -- see storyApi.ts
// for how the result gets written back as a Note. A story point is a
// moment in time: who it's about, and optionally where, when, and a photo
// -- all independently optional, since a point that only has a date, or
// only a place, or nothing but its own text, is still worth a card. This is
// deliberately narrow (person-only, one auto-draft rule) to test whether
// "JSON spec in a Note, rendered as a fullscreen card sequence" is worth
// building out further (family stories, hand-edited points, ...) before
// investing in any of that.
import { API_BASE } from "../config";
import { zipRefs, type ObjectDetail } from "./objectDetail";
import type { VisualData } from "./visualData";

export interface StoryPoint {
  personRefs?: string[];
  personNames?: string[];
  eventRef?: string;
  placeRef?: string;
  placeTitle?: string;
  lat?: number;
  long?: number;
  date?: string;
  year?: number;
  mediaRef?: string;
  mediaMime?: string;
  title: string;
  text: string;
}

export interface StorySpec {
  version: 1;
  title: string;
  intro: string;
  introMediaRef?: string;
  introMediaMime?: string;
  subjectRef: string;
  points: StoryPoint[];
}

interface MediaRefLike {
  ref: string;
}

async function fetchMediaMime(token: string, handle: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${API_BASE}/api/media/${encodeURIComponent(handle)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return undefined;
    const media = await res.json();
    return typeof media.mime === "string" ? media.mime : undefined;
  } catch {
    return undefined;
  }
}

/** First image among a list of MediaRefs, resolved one handle at a time --
 * there's no batch-mime endpoint, and a point's own media_list or a place's
 * is short enough (almost always 0 or 1 entries) that this doesn't need to
 * be cleverer than it is. */
async function firstImage(token: string, mediaList: MediaRefLike[]): Promise<{ ref: string; mime: string } | undefined> {
  for (const entry of mediaList) {
    const mime = await fetchMediaMime(token, entry.ref);
    if (mime?.startsWith("image/")) return { ref: entry.ref, mime };
  }
  return undefined;
}

async function fetchPlaceMediaList(token: string, handle: string): Promise<MediaRefLike[]> {
  try {
    const res = await fetch(`${API_BASE}/api/places/${encodeURIComponent(handle)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const place = await res.json();
    return Array.isArray(place.media_list) ? place.media_list : [];
  } catch {
    return [];
  }
}

/** A point's photo, in priority order: the event's own picture, then the
 * place it happened at, then (falling through to undefined here, and
 * handled by the caller) the person's own portrait -- three real fetches
 * in the worst case, and only for points that reach this far without
 * already finding one. Neither event.media_list nor a place's own are
 * resolved by extend=all (that only reaches one hop past the fetched
 * Person), so this is what one image per point actually costs. */
async function resolvePointMedia(
  token: string,
  eventMediaList: MediaRefLike[],
  placeHandle: string | undefined,
): Promise<{ ref: string; mime: string } | undefined> {
  const ownPhoto = await firstImage(token, eventMediaList);
  if (ownPhoto) return ownPhoto;
  if (!placeHandle) return undefined;
  const placeMediaList = await fetchPlaceMediaList(token, placeHandle);
  return firstImage(token, placeMediaList);
}

/** One point per event on `detail`, in the order recorded on
 * `event_ref_list` -- place and date are filled in whenever the local
 * caches have them, left off otherwise, rather than dropping the event for
 * lacking either (unlike a strictly map- or timeline-driven story, nothing
 * here requires coordinates or a parseable date). Returns null only when
 * the person has no events at all to draw from. */
export async function buildPersonStory(
  token: string,
  detail: ObjectDetail,
  personName: string,
  visualData: VisualData,
): Promise<StorySpec | null> {
  const placesByHandle = new Map(visualData.places.map((place) => [place.handle, place]));
  const rows = zipRefs<{ media_list?: MediaRefLike[] }>(detail.event_ref_list, detail.extended?.events);

  interface Draft {
    point: StoryPoint;
    placeHandle: string | undefined;
    eventMediaList: MediaRefLike[];
  }
  const dated: Draft[] = [];
  const undated: Draft[] = [];
  for (const { ref, target } of rows) {
    const record = visualData.eventsByHandle.get(ref.ref);
    if (!record) continue; // event not in the local cache (yet) -- nothing to describe it with
    const placeHandle = visualData.placeOfEvent.get(ref.ref);
    const place = placeHandle ? placesByHandle.get(placeHandle) : undefined;
    const point: StoryPoint = {
      personRefs: [detail.handle],
      personNames: [personName],
      eventRef: ref.ref,
      placeRef: place?.handle,
      placeTitle: place?.title,
      lat: place?.lat,
      long: place?.long,
      date: record.dateText || undefined,
      year: record.year ?? undefined,
      title: record.type,
      text: record.description || (place?.title ? `${record.type} at ${place.title}` : record.type),
    };
    const draft: Draft = { point, placeHandle, eventMediaList: target?.media_list ?? [] };
    (record.year === null ? undated : dated).push(draft);
  }
  if (dated.length === 0 && undated.length === 0) return null;
  dated.sort((a, b) => a.point.year! - b.point.year!);
  const drafts = [...dated, ...undated];

  // Every point's photo lookup runs together rather than one after another
  // -- otherwise a person with a dozen events would serialize a dozen
  // rounds of fetches end to end.
  await Promise.all(drafts.map(async (draft) => {
    const media = await resolvePointMedia(token, draft.eventMediaList, draft.placeHandle);
    draft.point.mediaRef = media?.ref;
    draft.point.mediaMime = media?.mime;
  }));
  const points = drafts.map((d) => d.point);

  // The person's own portrait, for the opening card and as every point's
  // last-resort fallback (see StoryView.tsx's slidesFor) -- already
  // resolved, since media_list is a top-level forward ref on the fetched
  // Person that extend=all covers for free.
  const portrait = zipRefs<{ mime?: string }>(detail.media_list, detail.extended?.media)
    .find((row) => row.target?.mime?.startsWith("image/"));

  return {
    version: 1,
    title: `The Story of ${personName}`,
    intro: `${points.length} moment${points.length === 1 ? "" : "s"} from ${personName}'s recorded life.`,
    introMediaRef: portrait?.ref.ref,
    introMediaMime: portrait?.target?.mime,
    subjectRef: detail.handle,
    points,
  };
}
