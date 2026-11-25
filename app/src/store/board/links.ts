// The only way the Evidence Board changes records: helpers that write every
// side of a link in one go, through a ChangeBuilder (changes.ts).
//
// POST /api/transactions/ stores records exactly as sent: it doesn't keep
// the two sides of a link in step (a family's child list and the child's
// parent-family list), and it doesn't recompute derived data (which of a
// person's events is their birth or death). These helpers do both, so a
// board never saves half a link.
//
// Field names and reference shapes are Gramps' own (object_to_dict form);
// see records.ts.
import type { ChangeBuilder } from "./changes";
import { blank, GENDER, grampsType, isType, type GrampsRecord } from "./records";

type Slot = "father" | "mother";
interface Ref {
  ref: string;
  [field: string]: unknown;
}

const handles = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : []);
const refs = (value: unknown): Ref[] => (Array.isArray(value) ? (value as Ref[]) : []);

function need(b: ChangeBuilder, handle: string): GrampsRecord {
  const record = b.get(handle);
  if (!record) throw new Error(`Record ${handle} is not on the board`);
  return record;
}

// --- new records ------------------------------------------------------------

export function newPerson(b: ChangeBuilder, fields: { first?: string; surname?: string; gender?: "F" | "M" | "U" }): string {
  const name = blank("Name", { first_name: fields.first ?? "", surname_list: [blank("Surname", { surname: fields.surname ?? "", primary: true })] });
  const gender = fields.gender === "F" ? GENDER.FEMALE : fields.gender === "M" ? GENDER.MALE : GENDER.UNKNOWN;
  return b.create("Person", { primary_name: name, gender });
}

/** `date` is a Gramps Date object (object_to_dict form); leave it out for
 * an undated event. */
export function newEvent(b: ChangeBuilder, typeName: string, fields: { date?: Record<string, unknown>; description?: string; custom?: string } = {}): string {
  const type = typeName === "CUSTOM" ? grampsType("EventType", "CUSTOM", fields.custom ?? "") : grampsType("EventType", typeName);
  return b.create("Event", { type, description: fields.description ?? "", ...(fields.date ? { date: fields.date } : {}) });
}

export function newPlace(b: ChangeBuilder, title: string, typeName = "CITY"): string {
  return b.create("Place", { title, name: blank("PlaceName", { value: title }), place_type: grampsType("PlaceType", typeName) });
}

export function newSource(b: ChangeBuilder, title: string, author = ""): string {
  return b.create("Source", { title, author });
}

/** A citation of `source` (`page`: where in it). */
export function newCitation(b: ChangeBuilder, source: string, page = ""): string {
  return b.create("Citation", { source_handle: source, page });
}

export function newRepository(b: ChangeBuilder, name: string, typeName = "LIBRARY"): string {
  return b.create("Repository", { name, type: grampsType("RepositoryType", typeName) });
}

/** A note. `customType` makes it a note of that custom type (e.g. "Case File"). */
export function newNote(b: ChangeBuilder, text: string, customType?: string): string {
  return b.create("Note", {
    text: blank("StyledText", { string: text }),
    ...(customType ? { type: grampsType("NoteType", "CUSTOM", customType) } : {}),
  });
}

export function setPersonName(b: ChangeBuilder, person: string, first: string, surname: string): void {
  const name = structuredClone(need(b, person).primary_name) as Record<string, unknown>;
  name.first_name = first;
  const surnames = refsOrBlank(name.surname_list);
  surnames[0] = { ...surnames[0], surname, primary: true };
  name.surname_list = surnames;
  b.set(person, "primary_name", name);
}

function refsOrBlank(value: unknown): Record<string, unknown>[] {
  const list = Array.isArray(value) ? structuredClone(value as Record<string, unknown>[]) : [];
  return list.length ? list : [blank("Surname", { primary: true })];
}

// --- families -----------------------------------------------------------------

function slotFor(person: GrampsRecord, family?: GrampsRecord): Slot {
  if (person.gender === GENDER.MALE) return "father";
  if (person.gender === GENDER.FEMALE) return "mother";
  return family?.father_handle ? "mother" : "father";
}

/** Puts `person` in `slot` of `family` (the other side: the person's own
 * family list). Whoever was in that slot is taken out first. */
export function setParent(b: ChangeBuilder, family: string, person: string, slot?: Slot): void {
  const fam = need(b, family);
  const chosen = slot ?? slotFor(need(b, person), fam);
  const field = `${chosen}_handle`;
  const previous = fam[field] as string | null;
  if (previous === person) return;
  if (previous && b.get(previous)) b.pull(previous, "family_list", family);
  b.set(family, field, person);
  b.push(person, "family_list", family);
}

/** Takes whoever is in `slot` out of `family`, on both sides. */
export function removeParent(b: ChangeBuilder, family: string, slot: Slot): void {
  const field = `${slot}_handle`;
  const person = need(b, family)[field] as string | null;
  if (!person) return;
  b.set(family, field, null);
  if (b.get(person)) b.pull(person, "family_list", family);
}

/** Adds `child` to `family` as a birth child, on both sides. */
export function addChild(b: ChangeBuilder, family: string, child: string): void {
  if (refs(need(b, family).child_ref_list).some((r) => r.ref === child)) return;
  b.push(family, "child_ref_list", blank("ChildRef", { ref: child }));
  b.push(child, "parent_family_list", family);
}

export function removeChild(b: ChangeBuilder, family: string, child: string): void {
  b.pull(family, "child_ref_list", child, true);
  if (b.get(child)) b.pull(child, "parent_family_list", family);
}

/** The first family where `person` is a parent, if any. */
export function familyOf(b: ChangeBuilder, person: string): string | undefined {
  return handles(need(b, person).family_list).find((f) => b.get(f));
}

/** The first family where `person` is a child, if any. */
export function parentFamilyOf(b: ChangeBuilder, person: string): string | undefined {
  return handles(need(b, person).parent_family_list).find((f) => b.get(f));
}

/** `parent` is a parent of `child`: through the parent's (first) family,
 * or a new family with the parent in it. */
export function linkParentChild(b: ChangeBuilder, parent: string, child: string): string {
  let family = familyOf(b, parent);
  if (!family) {
    family = b.create("Family");
    setParent(b, family, parent);
  }
  addChild(b, family, child);
  return family;
}

/** `x` and `y` are partners: a family with both, unless one exists. */
export function linkPartners(b: ChangeBuilder, x: string, y: string): string {
  const existing = handles(need(b, x).family_list).find((f) => {
    const fam = b.get(f);
    return fam && [fam.father_handle, fam.mother_handle].includes(y);
  });
  if (existing) return existing;
  const family = b.create("Family");
  let sx = slotFor(need(b, x));
  let sy = slotFor(need(b, y));
  if (sx === sy) [sx, sy] = ["father", "mother"];
  setParent(b, family, x, sx);
  setParent(b, family, y, sy);
  return family;
}

/** `x` and `y` are siblings: children of the same family (one of theirs,
 * or a new one with no parents yet). */
export function linkSiblings(b: ChangeBuilder, x: string, y: string): string {
  let family = parentFamilyOf(b, y) ?? parentFamilyOf(b, x);
  if (!family) family = b.create("Family");
  addChild(b, family, x);
  addChild(b, family, y);
  return family;
}

// --- events -------------------------------------------------------------------

/** Runs `mutate`, which changes `person`'s event references, then keeps
 * birth_ref_index / death_ref_index pointing at the right reference: the
 * one they pointed at before if it's still there, else the first primary
 * Birth (Death) event the board knows about, else none (-1). */
function keepingBirthDeath(b: ChangeBuilder, person: string, mutate: () => void): void {
  const before = need(b, person);
  const pointed = (index: unknown): string | undefined => refs(before.event_ref_list)[index as number]?.ref;
  const birth = pointed(before.birth_ref_index);
  const death = pointed(before.death_ref_index);
  mutate();
  const after = need(b, person);
  const list = refs(after.event_ref_list);
  const pick = (kept: string | undefined, eventType: string): number => {
    const at = kept ? list.findIndex((r) => r.ref === kept) : -1;
    // Kept if still there and still of that type (or not on the board, so
    // we can't tell: then trust what the tree had).
    const keptEvent = kept ? b.get(kept) : undefined;
    if (at >= 0 && (!keptEvent || isType(keptEvent.type, "EventType", eventType))) return at;
    return list.findIndex((r) => isType(r.role, "EventRoleType", "PRIMARY") && isType(b.get(r.ref)?.type, "EventType", eventType));
  };
  const birthIndex = pick(birth, "BIRTH");
  const deathIndex = pick(death, "DEATH");
  if (after.birth_ref_index !== birthIndex) b.set(person, "birth_ref_index", birthIndex);
  if (after.death_ref_index !== deathIndex) b.set(person, "death_ref_index", deathIndex);
}

/** `holder` (a person or family) took part in `event`. `role` is an
 * EventRoleType name (PRIMARY for a person's own event; families default
 * to FAMILY), or CUSTOM with `custom` text. */
export function addEventRef(b: ChangeBuilder, holder: string, event: string, role?: string, custom = ""): void {
  const record = need(b, holder);
  const roleName = role ?? (record._class === "Family" ? "FAMILY" : "PRIMARY");
  const roleValue = roleName === "CUSTOM" ? grampsType("EventRoleType", "CUSTOM", custom) : grampsType("EventRoleType", roleName);
  const ref = blank("EventRef", { ref: event, role: roleValue });
  if (record._class === "Person") keepingBirthDeath(b, holder, () => b.push(holder, "event_ref_list", ref));
  else b.push(holder, "event_ref_list", ref);
}

export function removeEventRef(b: ChangeBuilder, holder: string, event: string): void {
  if (need(b, holder)._class === "Person") keepingBirthDeath(b, holder, () => b.pull(holder, "event_ref_list", event, true));
  else b.pull(holder, "event_ref_list", event, true);
}

/** Changes an event's type, and fixes the birth/death of every person on
 * the board who has it. */
export function setEventType(b: ChangeBuilder, event: string, typeName: string, custom = ""): void {
  const type = typeName === "CUSTOM" ? grampsType("EventType", "CUSTOM", custom) : grampsType("EventType", typeName);
  const people = b.all().filter((r) => r._class === "Person" && refs(r.event_ref_list).some((x) => x.ref === event));
  b.set(event, "type", type);
  for (const person of people) keepingBirthDeath(b, person.handle, () => {});
}

export function setEventPlace(b: ChangeBuilder, event: string, place: string | null): void {
  b.set(event, "place", place);
}

// --- evidence -------------------------------------------------------------------

/** `citation` is evidence for `target` (a person, family, event, place or media). */
export function cite(b: ChangeBuilder, target: string, citation: string): void {
  b.push(target, "citation_list", citation);
}

export function uncite(b: ChangeBuilder, target: string, citation: string): void {
  b.pull(target, "citation_list", citation);
}

export function setCitationSource(b: ChangeBuilder, citation: string, source: string): void {
  b.set(citation, "source_handle", source);
}

/** `source` is kept at `repository`. */
export function addRepoRef(b: ChangeBuilder, source: string, repository: string): void {
  b.push(source, "reporef_list", blank("RepoRef", { ref: repository }));
}

export function removeRepoRef(b: ChangeBuilder, source: string, repository: string): void {
  b.pull(source, "reporef_list", repository, true);
}

// --- photos and notes -----------------------------------------------------------

/** A face or other region of a photo: Gramps' MediaRef.rect, `[left, top,
 * right, bottom]` as integer percentages of the image (see mediaCrop.ts). */
export type Region = [number, number, number, number];

function cleanRegion(rect: Region | null): Region | null {
  if (!rect) return null;
  const c = rect.map((n) => Math.max(0, Math.min(100, Math.round(n)))) as Region;
  return c[2] > c[0] && c[3] > c[1] ? c : null;
}

/** `media` shows `target` (or is attached to it), optionally only the
 * region `rect`. */
export function addMediaRef(b: ChangeBuilder, target: string, media: string, rect: Region | null = null): void {
  b.push(target, "media_list", blank("MediaRef", { ref: media, rect: cleanRegion(rect) }));
}

/** Changes the region of `target`'s reference to `media` (e.g. marking a
 * face). Adds the reference if there isn't one. */
export function setMediaRegion(b: ChangeBuilder, target: string, media: string, rect: Region | null): void {
  const list = refs(need(b, target).media_list);
  if (!list.some((r) => r.ref === media)) {
    addMediaRef(b, target, media, rect);
    return;
  }
  b.set(target, "media_list", list.map((r) => (r.ref === media ? { ...r, rect: cleanRegion(rect) } : r)));
}

/** Moves `target`'s reference to `media` to the front of its media list,
 * which makes it their main photo (the one on their card, as in Gramps). */
export function makeMainPhoto(b: ChangeBuilder, target: string, media: string): void {
  const list = refs(need(b, target).media_list);
  const i = list.findIndex((r) => r.ref === media);
  if (i <= 0) return;
  b.set(target, "media_list", [list[i], ...list.slice(0, i), ...list.slice(i + 1)]);
}

export function removeMediaRef(b: ChangeBuilder, target: string, media: string): void {
  b.pull(target, "media_list", media, true);
}

export function attachNote(b: ChangeBuilder, target: string, note: string): void {
  b.push(target, "note_list", note);
}

export function detachNote(b: ChangeBuilder, target: string, note: string): void {
  b.pull(target, "note_list", note);
}
