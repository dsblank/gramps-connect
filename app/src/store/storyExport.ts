// Turns a story into a portable .story.zip (the gramps-connect-stories
// format, packages/story) -- a snapshot that needs no tree, server or login
// to open. Three steps, so StoryDownloadDialog.tsx can show a live summary
// while its switches change without refetching anything:
//
//  1. gatherStoryExport() -- async, once per dialog open: hydrates the story
//     (storyHydration.ts, exactly what Present shows) and fetches the facts
//     the privacy switches need, which no local cache holds: each event's,
//     place's, media's and person's `private` flag, who each event is
//     about, which people each photo shows, and whether each of them is
//     living (gramps-web-api's /api/living/, the same probably_alive() rule
//     Gramps' own exports use).
//  2. planStoryExport() -- pure and synchronous: applies the switches and
//     produces the story.json (minus media files) plus a summary of what
//     was left out, or a reason the story can't be downloaded at all.
//  3. buildStoryZip() -- async: fetches and optimizes each image
//     (@gramps-connect/story's optimizeImage), fills in the media table,
//     and writes the zip, which validates it on the way.
//
// Leaving a record out is all-or-nothing per slide: a slide about a living
// or private person, or of a private event, is dropped, never edited, since
// its title and text name them. A private place drops just the slide's
// place; a photo that's private or shows a living person drops just the
// photo. Free text someone typed into a slide can't be checked and isn't
// changed -- the dialog says so.
import type { Feature } from "geojson";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import type { OptimizedImage, Place, Slide, StoryDoc } from "@gramps-connect/story";
import { API_BASE } from "../config";
import { getToken } from "../auth/auth";
import { apiFetch } from "./apiFetch";
import { toEdtf } from "./edtf";
import { fetchAllKmlFeatures, fetchAllKmlImageOverlays, type OverlayCorners } from "./kmlMedia";
import type { ObjectDetail } from "./objectDetail";
import { formatDisplayDate } from "./placeIndex";
import { personDisplayName, type RawPerson, type StorySpec } from "./storyBuilder";
import { hydrateStory, type HydratedSlide } from "./storyHydration";
import { isSubjectRole } from "./storyText";

// --- step 1: facts --------------------------------------------------------

export interface ExportPerson {
  handle: string;
  name: string;
  private: boolean;
  living: boolean;
}

export interface ExportMedia {
  handle: string;
  grampsId: string;
  mime: string;
  private: boolean;
  desc: string;
  /** People this media object is linked from -- who's in the picture, as
   * far as the tree knows. */
  personHandles: string[];
}

export interface ExportMapFile {
  handle: string;
  private: boolean;
  /** Its drawable shapes (no image overlays), as fetchAllKmlFeatures gives them. */
  features: Feature[];
  overlays: { imageHandle: string; corners: OverlayCorners; opacity: number; order: number }[];
}

export interface ExportSlide {
  hydrated: HydratedSlide;
  /** Undefined for a slide with no event (the opening card, or one added
   * by hand), and for an event that no longer exists. */
  event?: { grampsId: string; private: boolean; date?: GrampsDate; placePrivate: boolean };
  /** Handles of the people the slide's event is about: its Primary (or
   * other subject-role) participants, and both spouses of a family it
   * belongs to. Witnesses and the like aren't who a slide is about. */
  people: string[];
  /** Handles of the place's map files (the hydrated slide's kmlMedia). */
  mapFiles: string[];
}

export interface StoryExportSource {
  title: string;
  noteGrampsId: string;
  notePrivate: boolean;
  /** The people the story as a whole is about -- the person it's attached
   * to, or a family's spouses -- which is who the opening card names. */
  subjects: string[];
  slides: ExportSlide[];
  people: Map<string, ExportPerson>;
  media: Map<string, ExportMedia>;
  mapFiles: Map<string, ExportMapFile>;
}

async function getJson(token: string, path: string): Promise<any | null> {
  const res = await apiFetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  // A record deleted since the story was made is simply absent; anything
  // else is a failure to learn what the privacy switches depend on, and so
  // fails the whole export rather than guessing.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Couldn't check ${path} (${res.status}).`);
  return res.json();
}

function roleString(role: unknown): string | undefined {
  if (typeof role === "string") return role;
  if (role && typeof role === "object" && typeof (role as { string?: unknown }).string === "string") {
    return (role as { string: string }).string;
  }
  return undefined;
}

/** gramps-web-api answers an unset father/mother with "" or {} (see
 * storyBuilder.ts's note on the same quirk) -- only a real handle counts. */
function spouseHandles(family: unknown): string[] {
  const f = family as { father_handle?: unknown; mother_handle?: unknown } | null | undefined;
  return [f?.father_handle, f?.mother_handle]
    .filter((h): h is string => typeof h === "string" && h.length > 0);
}

/** One distinct fetch per key, however many slides ask. */
function memo<T>(fetcher: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>();
  return (key) => {
    let pending = cache.get(key);
    if (!pending) {
      pending = fetcher(key);
      cache.set(key, pending);
    }
    return pending;
  };
}

/** Step 1. `noteDetail` is the story Note as RelatedPanel fetched it
 * (extend=all, backlinks=1), which is where the story's own subjects come
 * from; `spec` is its parsed text. */
export async function gatherStoryExport(noteDetail: ObjectDetail, spec: StorySpec): Promise<StoryExportSource> {
  const token = await getToken();
  const hydrated = await hydrateStory(spec);

  const fetchEvent = memo((h) => getJson(token, `/api/events/${encodeURIComponent(h)}?backlinks=1&extend=backlinks`));
  const fetchPlace = memo((h) => getJson(token, `/api/places/${encodeURIComponent(h)}`));
  const fetchMedia = memo((h) => getJson(token, `/api/media/${encodeURIComponent(h)}?backlinks=1`));

  // The story's own subjects, off the Note's backlinks: the person it's
  // attached to, or a family's spouses.
  const backlinks = (noteDetail.extended?.backlinks ?? {}) as { person?: RawPerson[]; family?: unknown[] };
  // Whole Person records that backlinks already brought back, so the
  // people step below only fetches the ones nobody has sent yet.
  const personRecords = new Map<string, RawPerson & { private?: boolean }>();
  const subjects = new Set<string>();
  for (const p of backlinks.person ?? []) {
    if (!p?.handle) continue;
    subjects.add(p.handle);
    personRecords.set(p.handle, p);
  }
  for (const f of backlinks.family ?? []) for (const h of spouseHandles(f)) subjects.add(h);

  const slides: ExportSlide[] = await Promise.all(spec.points.map(async (point, i) => {
    const slide: ExportSlide = { hydrated: hydrated.slides[i], people: [], mapFiles: hydrated.slides[i].kmlMedia ?? [] };
    if (!point.eventRef) return slide;
    const event = await fetchEvent(point.eventRef);
    if (!event) return slide;
    const people = new Set<string>();
    const linked = (event.extended?.backlinks ?? {}) as { person?: RawPerson[]; family?: unknown[] };
    for (const person of linked.person ?? []) {
      if (person.handle) personRecords.set(person.handle, person);
      const refs = (person.event_ref_list ?? []).filter((r) => r.ref === point.eventRef);
      if (person.handle && refs.some((r) => isSubjectRole(roleString(r.role)))) people.add(person.handle);
    }
    for (const family of linked.family ?? []) for (const h of spouseHandles(family)) people.add(h);
    const place = typeof event.place === "string" && event.place ? await fetchPlace(event.place) : null;
    slide.event = {
      grampsId: event.gramps_id ?? "",
      private: Boolean(event.private),
      date: event.date ?? undefined,
      placePrivate: Boolean(place?.private),
    };
    slide.people = [...people];
    return slide;
  }));

  // Map files: their own privacy, shapes and image overlays, each file
  // fetched on its own so a private one can be left out by itself.
  const mapFiles = new Map<string, ExportMapFile>();
  await Promise.all([...new Set(slides.flatMap((s) => s.mapFiles))].map(async (handle) => {
    const [info, features, overlays] = await Promise.all([
      fetchMedia(handle), fetchAllKmlFeatures([handle]), fetchAllKmlImageOverlays([handle]),
    ]);
    if (!info) return;
    mapFiles.set(handle, {
      handle,
      private: Boolean(info.private),
      features,
      overlays: overlays.map((o) => ({ imageHandle: o.imageHandle, corners: o.corners, opacity: o.opacity, order: o.order })),
    });
  }));

  // Every image the story could show: slide photos and overlay images.
  const imageHandles = new Set<string>();
  for (const s of slides) if (s.hydrated.mediaRef && s.hydrated.mediaMime?.startsWith("image/")) imageHandles.add(s.hydrated.mediaRef);
  for (const f of mapFiles.values()) for (const o of f.overlays) imageHandles.add(o.imageHandle);
  const media = new Map<string, ExportMedia>();
  await Promise.all([...imageHandles].map(async (handle) => {
    const m = await fetchMedia(handle);
    if (!m || typeof m.mime !== "string" || !m.mime.startsWith("image/")) return;
    media.set(handle, {
      handle,
      grampsId: m.gramps_id ?? "",
      mime: m.mime,
      private: Boolean(m.private),
      desc: typeof m.desc === "string" ? m.desc : "",
      personHandles: Array.isArray(m.backlinks?.person) ? m.backlinks.person : [],
    });
  }));

  // Everyone whose privacy or living status decides something.
  const personHandles = new Set<string>([...subjects, ...slides.flatMap((s) => s.people)]);
  for (const m of media.values()) for (const h of m.personHandles) personHandles.add(h);
  const people = new Map<string, ExportPerson>();
  await Promise.all([...personHandles].map(async (handle) => {
    const [person, living] = await Promise.all([
      personRecords.get(handle) ?? getJson(token, `/api/people/${encodeURIComponent(handle)}`),
      getJson(token, `/api/living/${encodeURIComponent(handle)}`),
    ]);
    if (!person) return;
    people.set(handle, {
      handle,
      name: personDisplayName(person),
      private: Boolean(person.private),
      // Unknown counts as living: the cautious answer.
      living: living?.living !== false,
    });
  }));

  return {
    title: spec.title,
    noteGrampsId: typeof noteDetail.gramps_id === "string" ? noteDetail.gramps_id : "",
    notePrivate: Boolean(noteDetail.private),
    subjects: [...subjects],
    slides,
    people,
    media,
    mapFiles,
  };
}

// --- step 2: plan -----------------------------------------------------------

export interface ExportOptions {
  /** Keep records marked private. Only offered to users who can see them;
   * everyone else never receives them from the server in the first place. */
  includePrivate: boolean;
  includeLiving: boolean;
  /** Write Gramps IDs into the gramps-connect extension block. */
  includeIds: boolean;
}

export interface ExportMeta {
  language?: string;
  appVersion?: string;
  /** RFC 3339; defaults to now. */
  created?: string;
}

export interface PlannedMedia {
  key: string;
  handle: string;
  purpose: "photo" | "overlay";
  alt?: string;
}

export interface ExportSummary {
  slides: number;
  slidesLeftOut: number;
  photos: number;
  photosLeftOut: number;
  placesLeftOut: number;
  overlaysLeftOut: number;
}

export interface StoryExportPlan {
  /** Why the story can't be downloaded with these options, or null. */
  blocked: string | null;
  /** story.json without its media table, which buildStoryZip() fills in
   * once it knows each optimized file's format and size. */
  doc: Omit<StoryDoc, "media">;
  media: PlannedMedia[];
  summary: ExportSummary;
}

/** "de_AT" (this app's language codes) -> "de-AT" (BCP 47). */
function bcp47(lang: string | undefined): string | undefined {
  const tag = lang?.replace(/_/g, "-");
  return tag && /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(tag) ? tag : undefined;
}

/** Step 2. Pure: the same source and options always give the same plan. */
export function planStoryExport(source: StoryExportSource, options: ExportOptions, meta: ExportMeta = {}): StoryExportPlan {
  const personHidden = (handle: string): boolean => {
    const p = source.people.get(handle);
    // A person we couldn't look up is hidden whenever either filter is on.
    if (!p) return !options.includePrivate || !options.includeLiving;
    return (!options.includePrivate && p.private) || (!options.includeLiving && p.living);
  };
  const mediaHidden = (handle: string): boolean => {
    const m = source.media.get(handle);
    if (!m) return true;
    if (!options.includePrivate && m.private) return true;
    if (!options.includeLiving && m.personHandles.some((h) => source.people.get(h)?.living ?? true)) return true;
    return false;
  };

  let blocked: string | null = null;
  if (!options.includePrivate && source.notePrivate) {
    blocked = "This story is itself marked private.";
  } else if (source.subjects.some(personHidden)) {
    const reason = source.subjects
      .map((h) => source.people.get(h))
      .some((p) => p && !options.includeLiving && p.living)
      ? "living"
      : "private";
    blocked = reason === "living"
      ? "This story is about someone who may still be living. Turn on \"Include living people\" to download it."
      : "This story is about someone marked private. Turn on \"Include data marked private\" to download it.";
  }

  const mediaKeys = new Map<string, PlannedMedia>();
  const keyFor = (handle: string, purpose: PlannedMedia["purpose"]): string => {
    let planned = mediaKeys.get(handle);
    if (!planned) {
      const desc = source.media.get(handle)?.desc;
      planned = { key: `m${mediaKeys.size + 1}`, handle, purpose, ...(desc ? { alt: desc } : {}) };
      mediaKeys.set(handle, planned);
    } else if (purpose === "overlay") {
      // Used both ways: size it for the map, the larger of the two.
      planned.purpose = "overlay";
    }
    return planned.key;
  };

  const slides: Slide[] = [];
  const idExtension: Record<string, { event: string }> = {};
  let slidesLeftOut = 0;
  let placesLeftOut = 0;
  let overlaysLeftOut = 0;
  const photosSeen = new Set<string>();
  const photosHidden = new Set<string>();

  source.slides.forEach((s, i) => {
    const isOpening = i === 0 && !s.event;
    const people = isOpening ? source.subjects : s.people;
    if (s.event && ((!options.includePrivate && s.event.private) || people.some(personHidden))) {
      slidesLeftOut += 1;
      return;
    }
    const h = s.hydrated;
    const id = `s${slides.length}`;
    const slide: Slide = { id };
    if (h.title) slide.title = h.title;
    if (h.text) slide.text = h.text;
    if (h.date) {
      const edtf = toEdtf(s.event?.date);
      slide.date = {
        text: h.date,
        ...(edtf ? { edtf } : {}),
        ...(h.year != null ? { sortYear: Math.floor(h.year) } : {}),
      };
    }

    const hasPlace = h.placeTitle || (h.lat != null && h.long != null) || s.mapFiles.length > 0;
    if (hasPlace && !options.includePrivate && s.event?.placePrivate) {
      placesLeftOut += 1;
    } else if (hasPlace) {
      const place: Place = {};
      if (h.placeTitle) place.name = h.placeTitle;
      if (h.lat != null && h.long != null) {
        place.lat = h.lat;
        place.lon = h.long;
      }
      const files = s.mapFiles
        .map((handle) => source.mapFiles.get(handle))
        .filter((f): f is ExportMapFile => Boolean(f) && (options.includePrivate || !f!.private));
      const features = files.flatMap((f) => f.features);
      if (features.length > 0) place.geometry = { type: "FeatureCollection", features } as unknown as Place["geometry"];
      const overlays: NonNullable<Place["overlays"]> = [];
      const overlayDateText = formatDisplayDate(h.nameDate);
      const overlayEdtf = toEdtf(h.nameDate);
      for (const file of files) {
        for (const o of file.overlays) {
          if (mediaHidden(o.imageHandle)) {
            overlaysLeftOut += 1;
            continue;
          }
          overlays.push({
            media: keyFor(o.imageHandle, "overlay"),
            corners: o.corners,
            opacity: o.opacity,
            order: o.order,
            ...(overlayDateText ? { date: { text: overlayDateText, ...(overlayEdtf ? { edtf: overlayEdtf } : {}) } } : {}),
          });
        }
      }
      if (overlays.length > 0) place.overlays = overlays;
      if (Object.keys(place).length > 0) slide.place = place;
    }

    // The photo Present shows: the point's own, else the opening card's
    // (storyHydration.ts's fallback) -- written out explicitly here, since
    // the format has no fallback rule of its own.
    const photo = h.mediaRef && h.mediaMime?.startsWith("image/") ? h.mediaRef : undefined;
    if (photo) {
      photosSeen.add(photo);
      if (mediaHidden(photo)) photosHidden.add(photo);
      else slide.media = [{ ref: keyFor(photo, "photo") }];
    }

    const names = people.map((p) => source.people.get(p)?.name).filter((n): n is string => Boolean(n));
    if (names.length > 0) slide.people = names.map((name) => ({ name }));
    if (s.event?.grampsId) idExtension[id] = { event: s.event.grampsId };
    slides.push(slide);
  });

  const media = [...mediaKeys.values()];
  const doc: Omit<StoryDoc, "media"> = {
    format: "gramps-connect-story",
    version: "1.0",
    title: source.title,
    ...(bcp47(meta.language) ? { language: bcp47(meta.language) } : {}),
    created: meta.created ?? new Date().toISOString(),
    generator: { name: "Gramps Connect", ...(meta.appVersion ? { version: meta.appVersion } : {}) },
    presentation: { basemap: "auto" },
    slides,
  };
  if (options.includeIds) {
    doc.extensions = {
      "gramps-connect": {
        ...(source.noteGrampsId ? { story: source.noteGrampsId } : {}),
        slides: idExtension,
        media: Object.fromEntries(media.map((m) => [m.key, source.media.get(m.handle)?.grampsId ?? ""])),
      },
    };
  }

  return {
    blocked,
    doc,
    media,
    summary: {
      slides: slides.length,
      slidesLeftOut,
      photos: [...photosSeen].filter((p) => !photosHidden.has(p)).length,
      photosLeftOut: photosHidden.size,
      placesLeftOut,
      overlaysLeftOut,
    },
  };
}

// --- step 3: build ------------------------------------------------------------

/** Fetches and optimizes one image, or null when it can't be had. */
export type ImageLoader = (media: PlannedMedia) => Promise<Pick<OptimizedImage, "blob" | "mime" | "ext" | "width" | "height"> | null>;

/** The real loader: a photo comes from the thumbnail endpoint at a size a
 * little over what the viewer needs (never the full original over the
 * wire); an overlay comes from the original file, since thumbnails drop
 * transparency. Either way optimizeImage() then sizes, re-encodes and
 * strips its metadata. */
export function apiImageLoader(token: string): ImageLoader {
  return async (media) => {
    const path = media.purpose === "photo"
      ? `/api/media/${encodeURIComponent(media.handle)}/thumbnail/2048`
      : `/api/media/${encodeURIComponent(media.handle)}/file`;
    try {
      const res = await apiFetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const { optimizeImage } = await import("@gramps-connect/story");
      return await optimizeImage(await res.blob(), { purpose: media.purpose });
    } catch {
      return null;
    }
  };
}

export interface BuiltStory {
  zip: Blob;
  fileName: string;
  /** Images that couldn't be fetched or decoded, and so were left out. */
  failedImages: number;
}

/** Step 3. `onProgress(done, total)` ticks once per image. */
export async function buildStoryZip(
  plan: StoryExportPlan,
  loadImage: ImageLoader,
  onProgress?: (done: number, total: number) => void,
): Promise<BuiltStory> {
  if (plan.blocked) throw new Error(plan.blocked);
  const { writeStoryZip } = await import("@gramps-connect/story");

  const media: StoryDoc["media"] = {};
  const files = new Map<string, Blob>();
  const failed = new Set<string>();
  // One at a time: each optimizeImage() decodes and re-encodes on the main
  // thread, and a dozen at once would freeze the page for no real gain.
  for (const [i, planned] of plan.media.entries()) {
    onProgress?.(i, plan.media.length);
    const image = await loadImage(planned);
    if (!image) {
      failed.add(planned.key);
      continue;
    }
    const src = `media/${planned.key}.${image.ext}`;
    media[planned.key] = {
      src, mime: image.mime, width: image.width, height: image.height,
      ...(planned.alt ? { alt: planned.alt } : {}),
    };
    files.set(src, image.blob);
  }
  onProgress?.(plan.media.length, plan.media.length);

  const slides = plan.doc.slides.map((slide) => {
    if (failed.size === 0) return slide;
    const next: Slide = { ...slide };
    if (next.media) {
      next.media = next.media.filter((m) => !failed.has(m.ref));
      if (next.media.length === 0) delete next.media;
    }
    if (next.place?.overlays) {
      const overlays = next.place.overlays.filter((o) => !failed.has(o.media));
      next.place = { ...next.place };
      if (overlays.length > 0) next.place.overlays = overlays;
      else delete next.place.overlays;
    }
    return next;
  });
  // The plan is reused if the dialog downloads again, so copy, don't edit.
  let extensions = plan.doc.extensions;
  const ours = extensions?.["gramps-connect"];
  if (ours && failed.size > 0) {
    const ids = { ...(ours.media as Record<string, string>) };
    for (const key of failed) delete ids[key];
    extensions = { ...extensions, "gramps-connect": { ...ours, media: ids } };
  }

  const doc: StoryDoc = { ...plan.doc, slides, media, ...(extensions ? { extensions } : {}) };
  const bytes = await writeStoryZip(doc, files);
  return {
    zip: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
    fileName: storyFileName(plan.doc.title),
    failedImages: failed.size,
  };
}

/** "The Story of Josef Meyer" -> "The Story of Josef Meyer.story.zip",
 * minus characters some file system won't take. */
export function storyFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${safe || "story"}.story.zip`;
}
