// Turns a Person's or a Family's records into a story spec -- see
// storyApi.ts for how the result gets written back as a Note. A story point
// is a moment in time: who it's about, and optionally where, when, and a
// photo -- all independently optional, since a point that only has a date,
// or only a place, or nothing but its own text, is still worth a card.
//
// Two seeding rules so far, sharing everything downstream of "which events
// become points": a person story holds the person constant and varies the
// place, a family story holds the household constant and varies *who* each
// moment is about (see buildFamilyStory). Places and Events are the
// obvious next two, and should need no more than a third rule.
import { API_BASE } from "../config";
import { zipRefs, type ObjectDetail, type RawRef } from "./objectDetail";
import { describeMoment, isSubjectRole, joinNames } from "./storyText";
import type { VisualData } from "./visualData";

// A point is mostly a reference, not a description: place title,
// coordinates, date, and photo mime are derived at render time by
// storyHydration.ts from the same local eventsByHandle/places caches this
// module reads below, rather than copied in here where they'd go stale the
// moment the underlying Event or Place changes. `title` and `text` are the
// exception -- both are seeded when the point is built (storyText.ts) but
// live in the spec from then on, so a hand-edit to either sticks rather
// than being re-derived on every presentation.
//
// The story's opening card is just its first point: one with no
// `eventRef` (nothing but its own text and photo), rather than separate
// intro/introMediaRef fields of its own.
export interface StoryPoint {
  eventRef?: string;
  mediaRef?: string;
  /** Slide heading. Falls back at presentation time to the referenced
   * event's type (or, for the opening card, the story's own title) when
   * absent -- which is what every story generated before this field
   * existed still does. */
  title?: string;
  text?: string;
}

export interface StorySpec {
  title: string;
  points: StoryPoint[];
}

interface MediaRefLike {
  ref: string;
}

/** The handful of fields this module reads off a raw Person -- whether it
 * arrived as a Family's own extended.father/mother or as one of its
 * zipped extended.children. */
interface RawPerson {
  handle?: string;
  primary_name?: { first_name?: string; surname_list?: { surname?: string }[] };
  event_ref_list?: RawRef[];
  media_list?: MediaRefLike[];
}

/** Same given+surname reduction components/related/summary.ts does, kept
 * here because store/ modules don't import from components/ (see
 * storyApi.ts's note on the same convention). Only the raw shape is
 * handled: every Person this module sees arrives via `extended.*`, never
 * as a display-ready profile. */
function personDisplayName(person: RawPerson | undefined): string {
  const given = person?.primary_name?.first_name ?? "";
  const surname = person?.primary_name?.surname_list?.[0]?.surname ?? "";
  return [given, surname].filter(Boolean).join(" ");
}

/** Exported for storyHydration.ts, which resolves a mediaRef's mime type
 * at presentation time rather than storing it in the spec. */
export async function fetchMediaMime(token: string, handle: string): Promise<string | undefined> {
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

/** Per-build memo over the two lookups a point's photo needs -- one mime
 * fetch per media handle and one fetch per place, however many points ask
 * for the same one. A family story is exactly the case that makes this
 * worth having: eight children born in the same village would otherwise
 * refetch that village's media_list eight times. */
function makeMediaResolver(token: string) {
  const mimes = new Map<string, Promise<string | undefined>>();
  const placeLists = new Map<string, Promise<MediaRefLike[]>>();

  function mimeOf(handle: string): Promise<string | undefined> {
    let pending = mimes.get(handle);
    if (!pending) {
      pending = fetchMediaMime(token, handle);
      mimes.set(handle, pending);
    }
    return pending;
  }

  async function fetchPlaceMediaList(handle: string): Promise<MediaRefLike[]> {
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

  function placeMediaList(handle: string): Promise<MediaRefLike[]> {
    let pending = placeLists.get(handle);
    if (!pending) {
      pending = fetchPlaceMediaList(handle);
      placeLists.set(handle, pending);
    }
    return pending;
  }

  /** First image among a list of MediaRefs, resolved one handle at a time
   * -- there's no batch-mime endpoint, and any one list here (an event's,
   * a person's, a place's) is short enough that this doesn't need to be
   * cleverer than it is. */
  async function firstImage(mediaList: MediaRefLike[]): Promise<string | undefined> {
    for (const entry of mediaList) {
      const mime = await mimeOf(entry.ref);
      if (mime?.startsWith("image/")) return entry.ref;
    }
    return undefined;
  }

  /** A point's photo, in priority order: the event's own picture, then the
   * face of whoever the moment is about, then the place it happened at.
   * (A person story passes no portrait here -- its subject never changes,
   * so their portrait is the opening card's photo and storyHydration.ts
   * already falls every other point back to it.) Neither event.media_list
   * nor a place's own is resolved by extend=all -- that only reaches one
   * hop past the fetched object -- so this is what one image per point
   * actually costs. */
  return async function resolvePointMedia(draft: Draft): Promise<string | undefined> {
    const own = await firstImage(draft.eventMediaList);
    if (own) return own;
    const portrait = await firstImage(draft.subjectMediaList);
    if (portrait) return portrait;
    if (!draft.placeHandle) return undefined;
    return firstImage(await placeMediaList(draft.placeHandle));
  };
}

/** A point under construction, plus the three things only the seeding rule
 * knows: where it sorts, where it happened, and which media lists its
 * photo may be drawn from. */
interface Draft {
  point: StoryPoint;
  year: number | null;
  placeHandle: string | undefined;
  eventMediaList: MediaRefLike[];
  subjectMediaList: MediaRefLike[];
}

/** Builds one draft from an event handle, seeding its title and text from
 * whatever the event cache knows (storyText.ts). Returns null for an event
 * that isn't cached yet -- there'd be nothing to describe it with. */
function draftFromEvent(
  eventRef: string,
  role: string | undefined,
  subjects: string[],
  visualData: VisualData,
  media: { event?: MediaRefLike[]; subject?: MediaRefLike[] },
): Draft | null {
  const record = visualData.eventsByHandle.get(eventRef);
  if (!record) return null;
  const placeHandle = visualData.placeOfEvent.get(eventRef);
  const { title, text } = describeMoment({
    type: record.type,
    subjects,
    dateText: record.dateText,
    datePreposition: record.datePreposition,
    placeTitle: record.placeTitle,
    description: record.description,
    role,
  });
  return {
    point: { eventRef, title, text },
    year: record.year,
    placeHandle,
    eventMediaList: media.event ?? [],
    subjectMediaList: media.subject ?? [],
  };
}

/** Dated points in date order, then undated ones in the order the seeding
 * rule produced them (a person's own event_ref_list order; a family's
 * couple-then-parents-then-children walk). Then every photo lookup runs
 * together rather than one after another -- otherwise a dozen points would
 * serialize a dozen rounds of fetches end to end. */
async function assemblePoints(token: string, drafts: Draft[]): Promise<StoryPoint[]> {
  const dated = drafts.filter((d) => d.year !== null).sort((a, b) => a.year! - b.year!);
  const undated = drafts.filter((d) => d.year === null);
  const ordered = [...dated, ...undated];
  const resolveMedia = makeMediaResolver(token);
  await Promise.all(ordered.map(async (draft) => {
    draft.point.mediaRef = await resolveMedia(draft);
  }));
  return ordered.map((d) => d.point);
}

function momentCount(n: number): string {
  return `${n} moment${n === 1 ? "" : "s"}`;
}

/** One point per event on `detail`, plus a leading point for the opening
 * card -- a point is a reference plus (when one was found) a photo plus a
 * seeded title and text; place, date, and coordinates are resolved from the
 * event at presentation time by storyHydration.ts, not looked up here
 * (unlike a strictly map- or timeline-driven story, nothing here requires
 * coordinates or a parseable date up front). Returns null only when the
 * person has no events at all to draw from. */
export async function buildPersonStory(
  token: string,
  detail: ObjectDetail,
  personName: string,
  visualData: VisualData,
): Promise<StorySpec | null> {
  const rows = zipRefs<{ media_list?: MediaRefLike[] }>(detail.event_ref_list, detail.extended?.events);
  const drafts: Draft[] = [];
  for (const { ref, target } of rows) {
    const draft = draftFromEvent(ref.ref, ref.role, [personName], visualData, {
      event: target?.media_list ?? [],
    });
    if (draft) drafts.push(draft);
  }
  if (drafts.length === 0) return null;
  const points = await assemblePoints(token, drafts);

  // The person's own portrait, for the opening card and as every other
  // point's last-resort fallback (see storyHydration.ts's hydratePoint) --
  // already resolved, since media_list is a top-level forward ref on the
  // fetched Person that extend=all covers for free.
  const portrait = zipRefs<{ mime?: string }>(detail.media_list, detail.extended?.media)
    .find((row) => row.target?.mime?.startsWith("image/"));

  const title = `The Story of ${personName}`;
  const introPoint: StoryPoint = {
    mediaRef: portrait?.ref.ref,
    title,
    text: `${momentCount(points.length)} from ${personName}'s recorded life.`,
  };

  return { title, points: [introPoint, ...points] };
}

/** The events a spouse or a child contributes to their family's story.
 * Deliberately just the ones that open and close a life rather than every
 * event the person has: a family story is the household's arc, and pulling
 * in each member's census rows, occupations and residences would bury that
 * under what are really several person stories interleaved. Someone who
 * wants those can generate the person story, or add the slides by hand. */
const VITAL_TYPES = new Set(["Birth", "Stillbirth", "Death"]);

/** Every family member's own vital moments, in the order they're listed on
 * the Family (father, mother, then children as recorded). Skips an event
 * already drafted -- a Family and one of its members can both reference the
 * same event, and a story shouldn't show it twice -- and any event the
 * member only witnessed, since a family story is about what happened *to*
 * the household. */
function draftMemberMoments(
  members: RawPerson[],
  visualData: VisualData,
  seen: Set<string>,
): Draft[] {
  const drafts: Draft[] = [];
  for (const member of members) {
    const name = personDisplayName(member);
    for (const ref of member.event_ref_list ?? []) {
      if (seen.has(ref.ref)) continue;
      if (!isSubjectRole(ref.role)) continue;
      const record = visualData.eventsByHandle.get(ref.ref);
      if (!record || !VITAL_TYPES.has(record.type)) continue;
      const draft = draftFromEvent(ref.ref, ref.role, name ? [name] : [], visualData, {
        subject: member.media_list ?? [],
      });
      if (!draft) continue;
      seen.add(ref.ref);
      drafts.push(draft);
    }
  }
  return drafts;
}

/** A family's story: the couple's own events (marriage, divorce, a shared
 * residence or census) merged by date with the births and deaths of both
 * spouses and every child. What varies slide to slide is *who* the moment
 * is about, which is why each point's seeded title names them and each
 * point's photo prefers that person's own portrait over the place's -- the
 * mirror image of a person story, where the subject is fixed and the place
 * is what moves.
 *
 * Reads everything from what the Family fetch already returned plus the
 * local event cache: extend=all resolves father/mother/children/events one
 * hop out, and a member's own birth and death are then looked up by handle
 * in visualData.eventsByHandle rather than refetched. The one thing that
 * costs requests is photos (see makeMediaResolver).
 *
 * Returns null when nothing in the family -- couple or members -- has a
 * single cached event to build a point from. */
export async function buildFamilyStory(
  token: string,
  detail: ObjectDetail,
  visualData: VisualData,
): Promise<StorySpec | null> {
  // gramps-web-api answers an unset father_handle (and a broken child ref)
  // with an empty object rather than null -- see its util.py's
  // get_person_by_handle/catch_handle_error -- so "is this a real person"
  // has to be a handle check, not a truthiness one.
  const isPerson = (p: RawPerson | undefined): p is RawPerson => Boolean(p?.handle);
  const father = detail.extended?.father as RawPerson | undefined;
  const mother = detail.extended?.mother as RawPerson | undefined;
  const children = zipRefs<RawPerson>(detail.child_ref_list, detail.extended?.children)
    .map((row) => row.target)
    .filter(isPerson);

  const spouses = [father, mother].filter(isPerson);
  const spouseNames = spouses.map(personDisplayName).filter(Boolean);
  // "(this family)" rather than "(unnamed)": a Family with neither parent
  // set still has children whose story this is.
  const coupleLabel = joinNames(spouseNames) || "this family";

  const seen = new Set<string>();
  const drafts: Draft[] = [];

  // The couple's own events first, so an undated marriage still leads the
  // undated tail rather than trailing the children's undated births.
  const familyEvents = zipRefs<{ media_list?: MediaRefLike[] }>(detail.event_ref_list, detail.extended?.events);
  for (const { ref, target } of familyEvents) {
    const draft = draftFromEvent(ref.ref, ref.role, spouseNames, visualData, {
      event: target?.media_list ?? [],
      // No single portrait fits a couple's event, so its photo falls
      // through to the place (the church, the town) instead.
    });
    if (!draft) continue;
    seen.add(ref.ref);
    drafts.push(draft);
  }
  drafts.push(...draftMemberMoments([...spouses, ...children], visualData, seen));

  if (drafts.length === 0) return null;
  const points = await assemblePoints(token, drafts);

  // The opening card's photo: the family's own (a group portrait, a
  // wedding photo) if it has one, otherwise the first parent who has a
  // face. Resolved without a fetch either way -- the Family's own
  // media_list comes back mime-resolved from extend=all, and a parent's
  // photo is only used as a handle here.
  const familyPhoto = zipRefs<{ mime?: string }>(detail.media_list, detail.extended?.media)
    .find((row) => row.target?.mime?.startsWith("image/"))?.ref.ref;
  const parentPhoto = spouses.find((s) => (s.media_list ?? []).length > 0)?.media_list?.[0]?.ref;

  const childClause = children.length > 0
    ? ` and their ${children.length === 1 ? "child" : `${children.length} children`}`
    : "";
  const title = `The Story of ${coupleLabel}`;
  const introPoint: StoryPoint = {
    mediaRef: familyPhoto ?? parentPhoto,
    title,
    text: `${momentCount(points.length)} from the life of ${coupleLabel}${childClause}.`,
  };

  return { title, points: [introPoint, ...points] };
}
