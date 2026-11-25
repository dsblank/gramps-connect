// "Got a lead?" on the Evidence Board: a guide that turns one document or
// photo into records that cite it, by asking plain questions (what is it,
// where did it come from, who is in it, what was the occasion, what part
// did the others play). Pickers only, no AI.
//
// Every answer is staged as a loose end through these builders, like any
// other board action, so it shows on the board straight away and nothing
// reaches the tree until Save (the uploaded file itself is the exception:
// an upload always creates its Media record at once).
//
// Pure module: the records it reads are passed in, so the guide's UI loads
// what it needs (the Home person's family) and tests use small trees.
import type { ChangeBuilder } from "./changes";
import { addEventRef, addMediaRef, addRepoRef, cite, linkParentChild, linkPartners, linkSiblings, newCitation, newEvent, newPerson, newPlace, newRepository, newSource, removeEventRef, setEventPlace } from "./links";
import { GENDER, isType, type GrampsRecord, type Records } from "./records";

/** What the document is: its kinds, as chips; the chosen one prefills the title. */
export const DOC_KINDS = ["Photo", "Birth certificate", "Marriage certificate", "Death certificate", "Census page", "Letter", "Newspaper clipping", "Other"];

/** The occasions a document records, in plain words, with their Gramps
 * event type (CUSTOM ones carry their own name). */
export const OCCASIONS: { label: string; type: string; custom?: string }[] = [
  { label: "Wedding", type: "MARRIAGE" },
  { label: "Birth", type: "BIRTH" },
  { label: "Baptism", type: "BAPTISM" },
  { label: "Graduation", type: "GRADUATION" },
  { label: "Funeral", type: "BURIAL" },
  { label: "Census", type: "CENSUS" },
  { label: "Reunion", type: "CUSTOM", custom: "Reunion" },
  { label: "Other", type: "CUSTOM" },
];

/** The part someone else played at the occasion, with its Gramps event role
 * (CUSTOM ones carry their own name) and how a loose end says it. */
export const PART_ROLES: { label: string; role: string; custom?: string; phrase: string; weddingOnly?: boolean }[] = [
  { label: "Witness", role: "WITNESS", phrase: "a witness" },
  { label: "Bridesmaid", role: "CUSTOM", custom: "Bridesmaid", phrase: "a bridesmaid", weddingOnly: true },
  { label: "Best man", role: "CUSTOM", custom: "Best man", phrase: "the best man", weddingOnly: true },
  { label: "Guest", role: "CUSTOM", custom: "Guest", phrase: "a guest" },
  { label: "Officiant", role: "CLERGY", phrase: "the officiant" },
  { label: "Family member", role: "FAMILY", phrase: "there as family" },
  { label: "Other", role: "UNKNOWN", phrase: "there" },
];

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const childrenOf = (f: GrampsRecord | undefined): string[] =>
  Array.isArray(f?.child_ref_list) ? (f!.child_ref_list as { ref?: string }[]).map((c) => c.ref).filter((h): h is string => !!h) : [];
const parentsOf = (f: GrampsRecord | undefined): string[] =>
  [f?.father_handle, f?.mother_handle].filter((h): h is string => typeof h === "string" && !!h);

/** Handles to load, round by round, to work out the Home person's close
 * family: the person, then their families, then those families' people,
 * then the parents' own parent families and their people. */
export function familyToLoad(home: string, records: Records): string[] {
  const want = new Set<string>([home]);
  const h = records[home];
  if (h) {
    for (const f of [...list(h.parent_family_list), ...list(h.family_list)]) {
      want.add(f);
      const fam = records[f];
      for (const p of [...parentsOf(fam), ...childrenOf(fam)]) want.add(p);
    }
    for (const f of list(h.parent_family_list)) {
      for (const parent of parentsOf(records[f])) {
        for (const gf of list(records[parent]?.parent_family_list)) {
          want.add(gf);
          for (const p of [...parentsOf(records[gf]), ...childrenOf(records[gf])]) want.add(p);
        }
      }
    }
  }
  return [...want].filter((x) => !records[x]);
}

/** How someone is related to the Home person, as a key for a translated
 * label ("Your mother"). */
export type RelativeKey =
  | "You" | "Your father" | "Your mother" | "Your parent" | "Your brother" | "Your sister" | "Your sibling"
  | "Your partner" | "Your son" | "Your daughter" | "Your child" | "Your grandfather" | "Your grandmother"
  | "Your grandparent" | "Your uncle" | "Your aunt" | "Your aunt or uncle";

const gendered = (r: GrampsRecord | undefined, m: RelativeKey, f: RelativeKey, u: RelativeKey): RelativeKey =>
  r?.gender === GENDER.MALE ? m : r?.gender === GENDER.FEMALE ? f : u;

/** The Home person and their close family (parents, siblings, partners,
 * children, grandparents, aunts and uncles), closest first, from the
 * records loaded. Also their parents, for "X's sibling" choices. */
export function relativesOf(home: string, records: Records): { list: { handle: string; rel: RelativeKey }[]; parents: string[] } {
  const out: { handle: string; rel: RelativeKey }[] = [];
  const seen = new Set<string>();
  const add = (h: string | undefined, rel: RelativeKey) => {
    if (h && records[h] && !seen.has(h)) {
      seen.add(h);
      out.push({ handle: h, rel });
    }
  };
  const me = records[home];
  if (!me) return { list: out, parents: [] };
  add(home, "You");
  const parents: string[] = [];
  for (const f of list(me.parent_family_list)) {
    const fam = records[f];
    if (fam?.father_handle) add(fam.father_handle as string, "Your father");
    if (fam?.mother_handle) add(fam.mother_handle as string, "Your mother");
    parents.push(...parentsOf(fam));
    for (const c of childrenOf(fam)) add(c, gendered(records[c], "Your brother", "Your sister", "Your sibling"));
  }
  for (const f of list(me.family_list)) {
    const fam = records[f];
    for (const p of parentsOf(fam)) add(p, "Your partner");
    for (const c of childrenOf(fam)) add(c, gendered(records[c], "Your son", "Your daughter", "Your child"));
  }
  for (const parent of parents) {
    for (const gf of list(records[parent]?.parent_family_list)) {
      const fam = records[gf];
      for (const p of parentsOf(fam)) add(p, gendered(records[p], "Your grandfather", "Your grandmother", "Your grandparent"));
      for (const c of childrenOf(fam)) if (c !== parent) add(c, gendered(records[c], "Your uncle", "Your aunt", "Your aunt or uncle"));
    }
  }
  return { list: out, parents };
}

/** A way a new person found in the document could be related, to tie
 * them in: "Anna's parent", "John's sibling", "Ruth's partner". */
export interface RelationChoice {
  /** The person they're related to, and how ("parent" of them, etc.). */
  to: string;
  how: "parent" | "sibling" | "child" | "partner";
  build: (b: ChangeBuilder) => void;
}

/** The choices for new person `x`: parent, sibling or child of the Home
 * person; sibling or parent of the Home person's parents; partner of
 * anyone else in the document. */
export function relationChoices(home: string, x: string, others: string[], records: Records): RelationChoice[] {
  const out: RelationChoice[] = [];
  if (records[home] && home !== x) {
    out.push({ to: home, how: "parent", build: (b) => void linkParentChild(b, x, home) });
    out.push({ to: home, how: "sibling", build: (b) => void linkSiblings(b, x, home) });
    out.push({ to: home, how: "child", build: (b) => void linkParentChild(b, home, x) });
    for (const p of relativesOf(home, records).parents) {
      out.push({ to: p, how: "sibling", build: (b) => void linkSiblings(b, x, p) });
      out.push({ to: p, how: "parent", build: (b) => void linkParentChild(b, x, p) });
    }
  }
  for (const q of others) if (q !== x && records[q]) out.push({ to: q, how: "partner", build: (b) => void linkPartners(b, x, q) });
  return out;
}

/** An event already in the tree that may be the occasion the document
 * records: the couple's wedding (from a family with both), or someone's
 * own (primary) event of that type. `records` must hold the people, their
 * families and their events. */
export function existingEvent(occasion: { type: string; custom?: string }, who1: string | null, who2: string | null, records: Records): { event: string; family?: string } | null {
  if (occasion.type === "CUSTOM") return null;
  const ofType = (h: string) => isType(records[h]?.type, "EventType", occasion.type);
  const evRefs = (r: GrampsRecord | undefined) => (Array.isArray(r?.event_ref_list) ? (r!.event_ref_list as { ref: string; role?: unknown }[]) : []);
  if (occasion.type === "MARRIAGE") {
    if (!who1 || !who2) return null;
    for (const f of list(records[who1]?.family_list)) {
      const fam = records[f];
      if (!fam || !parentsOf(fam).includes(who2)) continue;
      const hit = evRefs(fam).find((r) => ofType(r.ref));
      if (hit) return { event: hit.ref, family: f };
    }
    return null;
  }
  if (!who1) return null;
  const hit = evRefs(records[who1]).find((r) => ofType(r.ref) && isType(r.role, "EventRoleType", "PRIMARY"));
  return hit ? { event: hit.ref } : null;
}

/** Events to load for existingEvent(): those of `who1` and of the
 * families they're a parent in. */
export function eventsToLoad(who1: string | null, records: Records): string[] {
  if (!who1) return [];
  const evs = (r: GrampsRecord | undefined) => (Array.isArray(r?.event_ref_list) ? (r!.event_ref_list as { ref: string }[]).map((x) => x.ref) : []);
  const out = [...evs(records[who1]), ...list(records[who1]?.family_list).flatMap((f) => evs(records[f]))];
  return out.filter((h) => !records[h]);
}

// --- the changes each step makes ------------------------------------------------

/** "What is it?": the source the document is, and a citation of it that
 * every fact from it will cite. The file (if any) is attached to both. */
export function addLeadSource(b: ChangeBuilder, title: string, media: string | null): { source: string; citation: string } {
  const source = newSource(b, title);
  const citation = newCitation(b, source);
  if (media) {
    addMediaRef(b, source, media);
    addMediaRef(b, citation, media);
  }
  return { source, citation };
}

/** "Where did you get it?": where the source is kept, a repository in the
 * tree or a new one (a family collection, unless said otherwise). */
export function addLeadRepository(b: ChangeBuilder, source: string, repo: { handle: string } | { name: string }): string {
  const handle = "handle" in repo ? repo.handle : newRepository(b, repo.name, "COLLECTION");
  addRepoRef(b, source, handle);
  return handle;
}

/** "Who is in it?": someone in the tree, or a new person, now in the
 * photo (when there's one) and citing the document. */
export function addLeadPerson(b: ChangeBuilder, lead: { media: string | null; citation: string | null }, who: { handle: string } | { first: string; surname: string; gender: "F" | "M" | "U" }): string {
  const person = "handle" in who ? who.handle : newPerson(b, who);
  const record = b.get(person);
  const has = (field: string, h: string) => Array.isArray(record?.[field]) && (record![field] as unknown[]).some((x) => x === h || (x as { ref?: string })?.ref === h);
  if (lead.media && !has("media_list", lead.media)) addMediaRef(b, person, lead.media);
  if (lead.citation && !has("citation_list", lead.citation)) cite(b, person, lead.citation);
  return person;
}

/** "What's the occasion?", when it's already in the tree: the document
 * becomes evidence for it. Nothing else about it changes. */
export function citeExistingEvent(b: ChangeBuilder, event: string, lead: { media: string | null; citation: string | null }): void {
  if (lead.citation) cite(b, event, lead.citation);
  if (lead.media) addMediaRef(b, event, lead.media);
}

/** "What's the occasion?", when it's new: the event, citing the document,
 * with its date and place, tied to the couple's family (a wedding; the
 * family is made if there isn't one) or to the person whose it is. */
export function addLeadEvent(
  b: ChangeBuilder,
  lead: { media: string | null; citation: string | null },
  occasion: { type: string; custom?: string },
  fields: { who1: string | null; who2: string | null; date: Record<string, unknown> | null; place: { handle: string } | { name: string } | null; otherName?: string },
): { event: string; family?: string; place?: string } {
  const custom = occasion.type === "CUSTOM" ? (occasion.custom ?? fields.otherName ?? "Event") : undefined;
  const event = newEvent(b, occasion.type, { ...(fields.date ? { date: fields.date } : {}), ...(custom ? { custom } : {}) });
  let place: string | undefined;
  if (fields.place) {
    place = "handle" in fields.place ? fields.place.handle : newPlace(b, fields.place.name);
    setEventPlace(b, event, place);
  }
  citeExistingEvent(b, event, lead);
  if (occasion.type === "MARRIAGE" && fields.who1 && fields.who2 && fields.who1 !== fields.who2) {
    const family = linkPartners(b, fields.who1, fields.who2);
    addEventRef(b, family, event);
    return { event, family, place };
  }
  if (fields.who1) addEventRef(b, fields.who1, event);
  return { event, place };
}

/** "What part did the others play?": `person`'s role at `event`, replacing
 * the one given before, if any. */
export function setLeadRole(b: ChangeBuilder, person: string, event: string, role: { role: string; custom?: string }, hadRole: boolean): void {
  if (hadRole) removeEventRef(b, person, event);
  addEventRef(b, person, event, role.role, role.custom ?? "");
}
