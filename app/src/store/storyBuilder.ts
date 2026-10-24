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
import { describeMoment, isBookkeepingEvent, isSubjectRole, joinNames, storyPhotoCaption, storyPhotoCredit } from "./storyText";
import { isStandardEventType } from "./views";
import type { VisualData } from "./visualData";
import { apiFetch } from "./apiFetch";

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
  /** The slide's first photo -- all a story had before slides could have
   * several, so a copy of the app that doesn't know `moreMediaRefs`
   * still shows it. Read and write the list with pointPhotos/withPhotos. */
  mediaRef?: string;
  /** The slide's other photos, in order, after `mediaRef`. */
  moreMediaRefs?: string[];
  /** Slide heading. Falls back at presentation time to the referenced
   * event's type (or, for the opening card, the story's own title) when
   * absent -- which is what every story generated before this field
   * existed still does. */
  title?: string;
  text?: string;
}

/** A point's photos, in order. */
export function pointPhotos(point: StoryPoint): string[] {
  return point.mediaRef ? [point.mediaRef, ...(point.moreMediaRefs ?? [])] : [...(point.moreMediaRefs ?? [])];
}

/** `point` with these photos (see StoryPoint.mediaRef for the split). */
export function withPhotos(point: StoryPoint, photos: string[]): StoryPoint {
  const { mediaRef: _first, moreMediaRefs: _rest, ...rest } = point;
  return {
    ...rest,
    ...(photos.length > 0 ? { mediaRef: photos[0] } : {}),
    ...(photos.length > 1 ? { moreMediaRefs: photos.slice(1) } : {}),
  };
}

/** How a story's map starts (the story format's `presentation.basemap`). */
export type StoryBasemap = "auto" | "standard" | "historical" | "none";

export interface StorySpec {
  title: string;
  points: StoryPoint[];
  /** The language the story is written in, as a BCP 47 tag ("en",
   * "fr-CA"). Unset, a download says the app's language. */
  language?: string;
  /** Unset is "auto" (the viewer's choice, starting on today's map). */
  basemap?: StoryBasemap;
}

/** A language tag the story format accepts ("en", "fr-CA"; Gramps' own
 * "fr_CA" is taken as that), or undefined. */
export function storyLanguageTag(lang: string | undefined): string | undefined {
  const tag = lang?.trim().replace(/_/g, "-");
  return tag && /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(tag) ? tag : undefined;
}

/** What StoryOptionsDialog.tsx collects before generating. Both fields are
 * opt-in extensions of each seeding rule's own default (see buildPersonStory
 * and buildFamilyStory) -- an absent/undefined StoryOptions produces exactly
 * what generateStory did before this existed. */
export interface StoryOptions {
  /** Person only: also draft vital moments from every family this person
   * belongs to, as a parent (family_list -- spouse, children) or as a child
   * (parent_family_list -- parents, siblings), plus each such family's own
   * events (marriage, divorce, ...). The person's own vital events are
   * already covered by their event_ref_list and never duplicated here. */
  includeFamilyEvents?: boolean;
  /** Family only: handles of members (father/mother/children) to leave out
   * of draftMemberMoments -- everyone is included when absent/empty. */
  excludedMemberHandles?: Set<string>;
}

interface MediaRefLike {
  ref: string;
}

/** The handful of fields this module reads off a raw Person -- whether it
 * arrived as a Family's own extended.father/mother or as one of its
 * zipped extended.children. */
export interface RawPerson {
  handle?: string;
  /** Gramps' Person.gender: 0 female, 1 male, anything else unknown. */
  gender?: number;
  primary_name?: {
    first_name?: string;
    suffix?: string;
    surname_list?: { surname?: string; prefix?: string }[];
  };
  event_ref_list?: RawRef[];
  media_list?: MediaRefLike[];
}

/** A suffix that belongs in a name read aloud ("Jr", "Sr", "III", "2nd"),
 * as opposed to a title or office a GEDCOM import often puts in the suffix
 * field instead ("King of England", "Lady"). */
const GENERATIONAL_SUFFIX = /^(jr|sr|[ivx]+|\d+(st|nd|rd|th))\.?$/i;

/** A person's name as a sentence uses it: given names, then the surname
 * with its prefix ("van Gogh"), then a generational suffix -- never the
 * Gramps ID or the surname-first order list rows use. Kept here rather
 * than in components/related/summary.ts because store/ modules don't
 * import from components/ (see storyApi.ts's note on the same convention).
 * Only the raw shape is handled: every Person this module sees arrives as
 * a fetched raw Person or via `extended.*`, never as a display-ready
 * profile. */
export function personDisplayName(person: RawPerson | undefined): string {
  const name = person?.primary_name;
  const given = name?.first_name?.trim() ?? "";
  const first = name?.surname_list?.[0];
  const surname = [first?.prefix?.trim(), first?.surname?.trim()].filter(Boolean).join(" ");
  const suffix = name?.suffix?.trim() ?? "";
  return [given, surname, GENERATIONAL_SUFFIX.test(suffix) ? suffix : ""].filter(Boolean).join(" ");
}

type Kin = "parent" | "sibling" | "spouse" | "child";

const KIN_WORDS: Record<Kin, [female: string, male: string, other: string]> = {
  parent: ["mother", "father", "parent"],
  sibling: ["sister", "brother", "sibling"],
  spouse: ["wife", "husband", "spouse"],
  child: ["daughter", "son", "child"],
};

/** "His", "Her" or "Their", for the person a story is about. A family
 * story is about a couple, which is always "Their". */
function possessive(person: RawPerson | undefined): string {
  return person?.gender === 1 ? "His" : person?.gender === 0 ? "Her" : "Their";
}

/** "His father", "Their daughter": how `relative` is related to the story
 * subject whose possessive is `owner`. */
function relationPhrase(owner: string, kin: Kin, relative: RawPerson): string {
  const [female, male, other] = KIN_WORDS[kin];
  const word = relative.gender === 0 ? female : relative.gender === 1 ? male : other;
  return `${owner} ${word}`;
}

/** A raw Family, extend=all'd -- resolves father/mother/children one hop
 * out, which is what both buildFamilyStory and buildPersonStory's
 * includeFamilyEvents option need. Person.family_list/parent_family_list
 * only resolve to bare Family objects at that same one-hop depth (see
 * ParentsSection.tsx's doc comment), so a person's own families are
 * refetched individually here rather than read off `detail.extended`. */
async function fetchFamilyDetail(token: string, handle: string): Promise<any | null> {
  try {
    const res = await apiFetch(`${API_BASE}/api/families/${encodeURIComponent(handle)}?extend=all`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** A Family's father/mother (present) and children, off its own extend=all
 * shape -- shared by buildFamilyStory and buildPersonStory's
 * includeFamilyEvents option so both read father_handle/mother_handle's
 * "{}" -when-unset convention (see PlaceSection's doc comment on the same
 * gramps-web-api quirk) the same way. */
function extractFamilyMembers(familyRaw: any): { spouses: RawPerson[]; children: RawPerson[] } {
  const isPerson = (p: RawPerson | undefined): p is RawPerson => Boolean(p?.handle);
  const father = familyRaw?.extended?.father as RawPerson | undefined;
  const mother = familyRaw?.extended?.mother as RawPerson | undefined;
  const children = zipRefs<RawPerson>(familyRaw?.child_ref_list, familyRaw?.extended?.children)
    .map((row) => row.target)
    .filter(isPerson);
  return { spouses: [father, mother].filter(isPerson), children };
}

/** What a slide shows about one of its photos, read from the Media object
 * at presentation time rather than stored in the spec -- so its caption and
 * credit stay the tree's own (see storyText.ts's storyPhotoCaption and
 * storyPhotoCredit). */
export interface MediaInfo {
  mime?: string;
  caption?: string;
  credit?: string;
}

/** Exported for storyHydration.ts, which resolves each photo's MediaInfo
 * when a story is shown or downloaded. */
export async function fetchMediaInfo(token: string, handle: string): Promise<MediaInfo> {
  try {
    const res = await apiFetch(`${API_BASE}/api/media/${encodeURIComponent(handle)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return {};
    const media = await res.json();
    const caption = storyPhotoCaption(typeof media.desc === "string" ? media.desc : "");
    const credit = storyPhotoCredit(Array.isArray(media.attribute_list) ? media.attribute_list : []);
    return {
      ...(typeof media.mime === "string" ? { mime: media.mime } : {}),
      ...(caption ? { caption } : {}),
      ...(credit ? { credit } : {}),
    };
  } catch {
    return {};
  }
}

async function fetchMediaMime(token: string, handle: string): Promise<string | undefined> {
  return (await fetchMediaInfo(token, handle)).mime;
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
      const res = await apiFetch(`${API_BASE}/api/places/${encodeURIComponent(handle)}`, {
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

  /** A point's photos, in priority order: the event's own picture, then the
   * faces of whoever the moment is about -- both spouses, for a couple's
   * event -- then the place it happened at. (A person story passes no
   * portrait for the subject's own events -- the subject never changes, so
   * their portrait is the opening card's photo and storyHydration.ts
   * already falls every other point back to it.) Neither event.media_list
   * nor a place's own is resolved by extend=all -- that only reaches one
   * hop past the fetched object -- so this is what a point's photos
   * actually cost. */
  return async function resolvePointMedia(draft: Draft): Promise<string[]> {
    const own = await firstImage(draft.eventMediaList);
    if (own) return [own];
    const portraits: string[] = [];
    for (const list of draft.subjectMediaLists) {
      const portrait = await firstImage(list);
      if (portrait && !portraits.includes(portrait)) portraits.push(portrait);
    }
    if (portraits.length > 0) return portraits;
    if (!draft.placeHandle) return [];
    const placePhoto = await firstImage(await placeMediaList(draft.placeHandle));
    return placePhoto ? [placePhoto] : [];
  };
}

/** A point under construction, plus the three things only the seeding rule
 * knows: where it sorts, where it happened, and which media lists its
 * photos may be drawn from. */
interface Draft {
  point: StoryPoint;
  year: number | null;
  placeHandle: string | undefined;
  eventMediaList: MediaRefLike[];
  /** One media list per person the moment is about, in order. */
  subjectMediaLists: MediaRefLike[][];
}

/** Builds one draft from an event handle, seeding its title and text from
 * whatever the event cache knows (storyText.ts). Returns null for an event
 * that isn't cached yet -- there'd be nothing to describe it with -- and
 * for a record-keeping one (isBookkeepingEvent), which isn't a moment. */
function draftFromEvent(
  eventRef: string,
  role: string | undefined,
  subjects: string[],
  visualData: VisualData,
  media: { event?: MediaRefLike[]; subjects?: MediaRefLike[][] },
  relation?: string,
): Draft | null {
  const record = visualData.eventsByHandle.get(eventRef);
  if (!record) return null;
  const placeHandle = visualData.placeOfEvent.get(eventRef);
  if (isBookkeepingEvent(record.type, isStandardEventType(record.type), Boolean(record.dateText), Boolean(placeHandle || record.placeTitle))) {
    return null;
  }
  const { title, text } = describeMoment({
    type: record.type,
    subjects,
    dateText: record.dateText,
    datePreposition: record.datePreposition,
    placeTitle: record.placeTitle,
    description: record.description,
    role,
    relation,
  });
  return {
    point: { eventRef, title, text },
    year: record.year,
    placeHandle,
    eventMediaList: media.event ?? [],
    subjectMediaLists: media.subjects ?? [],
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
    draft.point = withPhotos(draft.point, await resolveMedia(draft));
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
  options?: StoryOptions,
): Promise<StorySpec | null> {
  // The name as a sentence reads it (no Gramps ID, given name first); the
  // caller's label only when the record has no name to build one from.
  const subject = detail as RawPerson;
  const name = personDisplayName(subject) || personName;
  const owner = possessive(subject);

  const seen = new Set<string>();
  const rows = zipRefs<{ media_list?: MediaRefLike[] }>(detail.event_ref_list, detail.extended?.events);
  const drafts: Draft[] = [];
  for (const { ref, target } of rows) {
    const draft = draftFromEvent(ref.ref, ref.role, [name], visualData, {
      event: target?.media_list ?? [],
    });
    if (draft) {
      seen.add(ref.ref);
      drafts.push(draft);
    }
  }

  // "Include families": every family this person is a parent in
  // (family_list -- spouse, children) or a child in (parent_family_list --
  // parents, siblings), each family's own events plus its members' vital
  // moments -- the same rule buildFamilyStory applies to a Family, just run
  // once per family this person belongs to rather than once for the family
  // itself. This person's own vital events are already drafted above and
  // never redrawn here (`seen`, and the `!== detail.handle` filter below).
  // Each relative's moment says how they're related ("His father, ..."),
  // which is what the family the event came through tells us.
  if (options?.includeFamilyEvents) {
    const ownFamilies = (detail.family_list as string[] | undefined) ?? [];
    const parentFamilies = (detail.parent_family_list as string[] | undefined) ?? [];
    const familyHandles = [...ownFamilies, ...parentFamilies];
    const families = await Promise.all(familyHandles.map((h) => fetchFamilyDetail(token, h)));
    families.forEach((familyRaw, i) => {
      if (!familyRaw) return;
      const asChild = i >= ownFamilies.length;
      const { spouses, children } = extractFamilyMembers(familyRaw);
      const spouseNames = spouses.map(personDisplayName).filter(Boolean);
      const familyEvents = zipRefs<{ media_list?: MediaRefLike[] }>(familyRaw.event_ref_list, familyRaw.extended?.events);
      for (const { ref, target } of familyEvents) {
        if (seen.has(ref.ref)) continue;
        const draft = draftFromEvent(ref.ref, ref.role, spouseNames, visualData, {
          event: target?.media_list ?? [],
          subjects: spouses.map((s) => s.media_list ?? []),
        }, asChild && spouseNames.length > 1 ? `${owner} parents` : undefined);
        if (!draft) continue;
        seen.add(ref.ref);
        drafts.push(draft);
      }
      const relationOf = (member: RawPerson): string => {
        const isSpouse = spouses.includes(member);
        const kin: Kin = asChild ? (isSpouse ? "parent" : "sibling") : (isSpouse ? "spouse" : "child");
        return relationPhrase(owner, kin, member);
      };
      const others = [...spouses, ...children].filter((p) => p.handle !== detail.handle);
      drafts.push(...draftMemberMoments(others, visualData, seen, relationOf));
    });
  }

  if (drafts.length === 0) return null;
  const points = await assemblePoints(token, drafts);

  // The person's own portrait, for the opening card and as every other
  // point's last-resort fallback (see storyHydration.ts's hydratePoint) --
  // already resolved, since media_list is a top-level forward ref on the
  // fetched Person that extend=all covers for free.
  const portrait = zipRefs<{ mime?: string }>(detail.media_list, detail.extended?.media)
    .find((row) => row.target?.mime?.startsWith("image/"));

  const title = `The Story of ${name}`;
  const span = lifespan(rows.map(({ ref }) => ref), visualData);
  const introPoint: StoryPoint = {
    mediaRef: portrait?.ref.ref,
    title,
    text: `${momentCount(points.length)} from the life of ${name}${span ? ` (${span})` : ""}.`,
  };

  return { title, points: [introPoint, ...points] };
}

/** "1895–1952", "born 1895", "died 1952", or "" -- from the person's own
 * dated Birth and Death events. */
function lifespan(refs: RawRef[], visualData: VisualData): string {
  let born: number | null = null;
  let died: number | null = null;
  for (const ref of refs) {
    if (!isSubjectRole(ref.role)) continue;
    const record = visualData.eventsByHandle.get(ref.ref);
    if (!record || record.year === null) continue;
    if (record.type === "Birth" && born === null) born = Math.floor(record.year);
    if (record.type === "Death" && died === null) died = Math.floor(record.year);
  }
  if (born !== null && died !== null) return `${born}–${died}`;
  if (born !== null) return `born ${born}`;
  if (died !== null) return `died ${died}`;
  return "";
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
  /** How each member is related to the story's subject ("His father"),
   * or undefined for one the sentence should simply name. */
  relationOf?: (member: RawPerson) => string | undefined,
): Draft[] {
  const drafts: Draft[] = [];
  for (const member of members) {
    const name = personDisplayName(member);
    const relation = relationOf?.(member);
    for (const ref of member.event_ref_list ?? []) {
      if (seen.has(ref.ref)) continue;
      if (!isSubjectRole(ref.role)) continue;
      const record = visualData.eventsByHandle.get(ref.ref);
      if (!record || !VITAL_TYPES.has(record.type)) continue;
      const draft = draftFromEvent(ref.ref, ref.role, name ? [name] : [], visualData, {
        subjects: [member.media_list ?? []],
      }, relation);
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
  options?: StoryOptions,
): Promise<StorySpec | null> {
  // gramps-web-api answers an unset father_handle (and a broken child ref)
  // with an empty object rather than null -- see its util.py's
  // get_person_by_handle/catch_handle_error -- so "is this a real person"
  // has to be a handle check, not a truthiness one; extractFamilyMembers
  // applies the same check.
  const { spouses, children } = extractFamilyMembers(detail);
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
      // Both spouses' portraits, side by side; the place's photo (the
      // church, the town) only when neither has one.
      subjects: spouses.map((s) => s.media_list ?? []),
    });
    if (!draft) continue;
    seen.add(ref.ref);
    drafts.push(draft);
  }
  const excluded = options?.excludedMemberHandles;
  const included = excluded && excluded.size > 0
    ? [...spouses, ...children].filter((p) => !excluded.has(p.handle!))
    : [...spouses, ...children];
  // The couple are named as themselves; a child as "Their son, ...".
  const relationOf = (member: RawPerson) => (spouses.includes(member) ? undefined : relationPhrase("Their", "child", member));
  drafts.push(...draftMemberMoments(included, visualData, seen, relationOf));

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
