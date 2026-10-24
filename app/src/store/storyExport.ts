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
//     was left out, or a reason the story can't be downloaded at all. The
//     slides themselves are built by storyDoc.ts, the same conversion
//     Present uses.
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
import type { OptimizedImage, Slide, StoryDoc } from "@gramps-connect/story";
import { API_BASE } from "../config";
import { getToken } from "../auth/auth";
import { apiFetch } from "./apiFetch";
import type { ObjectDetail } from "./objectDetail";
import { personDisplayName, storyLanguageTag, type RawPerson, type StoryBasemap, type StorySpec } from "./storyBuilder";
import { mediaKeys, slidePhotos, slideToDoc } from "./storyDoc";
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

/** A map file's privacy; its shapes and overlays are on the hydrated
 * slide (HydratedSlide.mapFiles). */
export interface ExportMapFile {
  handle: string;
  private: boolean;
}

export interface ExportSlide {
  hydrated: HydratedSlide;
  /** Undefined for a slide with no event (the opening card, or one added
   * by hand), and for an event that no longer exists. */
  event?: { grampsId: string; private: boolean; placePrivate: boolean };
  /** Handles of the people the slide's event is about: its Primary (or
   * other subject-role) participants, and both spouses of a family it
   * belongs to. Witnesses and the like aren't who a slide is about. */
  people: string[];
}

export interface StoryExportSource {
  title: string;
  /** The story's own settings (see StorySpec). */
  language?: string;
  basemap?: StoryBasemap;
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
    const slide: ExportSlide = { hydrated: hydrated.slides[i], people: [] };
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
      placePrivate: Boolean(place?.private),
    };
    slide.people = [...people];
    return slide;
  }));

  // Map files: each one's own privacy, so a private one can be left out
  // by itself. (Their shapes and overlays came with hydration.)
  const hydratedMapFiles = hydrated.slides.flatMap((h) => h.mapFiles ?? []);
  const mapFiles = new Map<string, ExportMapFile>();
  await Promise.all([...new Set(hydratedMapFiles.map((f) => f.handle))].map(async (handle) => {
    const info = await fetchMedia(handle);
    if (info) mapFiles.set(handle, { handle, private: Boolean(info.private) });
  }));

  // Every image the story could show: slide photos and overlay images.
  const imageHandles = new Set<string>();
  for (const s of slides) {
    for (const photo of slidePhotos(s.hydrated)) imageHandles.add(photo);
  }
  for (const f of hydratedMapFiles) for (const o of f.overlays) imageHandles.add(o.imageHandle);
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
    ...(spec.language ? { language: spec.language } : {}),
    ...(spec.basemap ? { basemap: spec.basemap } : {}),
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

  const keys = mediaKeys();

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
    // Each photo by itself: a hidden one drops just that photo.
    const photos = slidePhotos(h);
    for (const photo of photos) {
      photosSeen.add(photo);
      if (mediaHidden(photo)) photosHidden.add(photo);
    }
    const dropPlace = !options.includePrivate && Boolean(s.event?.placePrivate);
    const names = people.map((p) => source.people.get(p)?.name).filter((n): n is string => Boolean(n));
    const built = slideToDoc({
      id,
      hydrated: h,
      mapFiles: (h.mapFiles ?? []).filter((f) => {
        const info = source.mapFiles.get(f.handle);
        return Boolean(info) && (options.includePrivate || !info!.private);
      }),
      dropPlace,
      overlayAllowed: (imageHandle) => !mediaHidden(imageHandle),
      photos: photos.filter((photo) => !mediaHidden(photo)),
      people: names,
    }, keys.keyFor);
    if (dropPlace && built.hadPlace) placesLeftOut += 1;
    overlaysLeftOut += built.overlaysLeftOut;
    const slide = built.slide;
    if (s.event?.grampsId) idExtension[id] = { event: s.event.grampsId };
    slides.push(slide);
  });

  const media: PlannedMedia[] = keys.entries().map((entry) => {
    const desc = source.media.get(entry.handle)?.desc;
    return { ...entry, ...(desc ? { alt: desc } : {}) };
  });
  const language = storyLanguageTag(source.language) ?? storyLanguageTag(meta.language);
  const doc: Omit<StoryDoc, "media"> = {
    format: "gramps-connect-story",
    version: "1.0",
    title: source.title,
    // The story's own language, else the app's.
    ...(language ? { language } : {}),
    created: meta.created ?? new Date().toISOString(),
    generator: { name: "Gramps Connect", ...(meta.appVersion ? { version: meta.appVersion } : {}) },
    presentation: { basemap: source.basemap ?? "auto" },
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
