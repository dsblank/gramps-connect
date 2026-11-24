// Tying and snipping yarn on the Evidence Board, in plain words. Ported from
// the prototype's connectOptions(), now built on the link helpers
// (links.ts), so every choice writes both sides of its link.
//
// - connectOptions(): what two records can mean to each other ("Ruth is a
//   child of John", "It happened at Springfield"), each with the action
//   that makes it so.
// - newTypesFor(): what new record can be made already tied to one
//   (yarn pulled into empty board).
// - snip(): takes away the link a piece of yarn stands for.
import type { ChangeBuilder } from "./changes";
import {
  addChild,
  addEventRef,
  addMediaRef,
  addRepoRef,
  attachNote,
  cite,
  detachNote,
  linkParentChild,
  linkPartners,
  linkSiblings,
  newCitation,
  removeChild,
  removeEventRef,
  removeMediaRef,
  removeParent,
  removeRepoRef,
  setCitationSource,
  setEventPlace,
  setParent,
  uncite,
} from "./links";
import type { GrampsClass, GrampsRecord, Records } from "./records";
import { titleOf, type Yarn } from "./view";

export interface ConnectOption {
  /** In plain words, e.g. "Ruth is a child of John". */
  label: string;
  build: (b: ChangeBuilder) => void;
}

/** A person's role in an event, as the board offers it. */
const ROLES: [string, string][] = [
  ["PRIMARY", "was the main person"],
  ["WITNESS", "was a witness"],
  ["BRIDE", "was the bride"],
  ["GROOM", "was the groom"],
  ["CLERGY", "officiated"],
  ["INFORMANT", "was the informant"],
  ["UNKNOWN", "was there (another role)"],
];

function shortName(r: GrampsRecord, records: Records): string {
  if (!records[r.handle]) return `the new ${r._class.toLowerCase()}`;
  if (r._class === "Person") {
    const first = (r.primary_name as { first_name?: string } | undefined)?.first_name;
    return first || titleOf(r.handle, records);
  }
  return titleOf(r.handle, records);
}

/** The ways records `a` and `b` can be tied, in plain words. Empty when
 * they can't be tied directly (say, a place and a repository). */
export function connectOptions(records: Records, a: GrampsRecord, b: GrampsRecord): ConnectOption[] {
  const out: ConnectOption[] = [];
  const n = (r: GrampsRecord) => shortName(r, records);
  const pair = (x: GrampsClass, y: GrampsClass): [GrampsRecord, GrampsRecord] | null =>
    a._class === x && b._class === y ? [a, b] : a._class === y && b._class === x ? [b, a] : null;
  let p: [GrampsRecord, GrampsRecord] | null;

  if (a._class === "Person" && b._class === "Person") {
    out.push({ label: `${n(a)} is a parent of ${n(b)}`, build: (bb) => void linkParentChild(bb, a.handle, b.handle) });
    out.push({ label: `${n(a)} is a child of ${n(b)}`, build: (bb) => void linkParentChild(bb, b.handle, a.handle) });
    out.push({ label: `${n(a)} and ${n(b)} are partners`, build: (bb) => void linkPartners(bb, a.handle, b.handle) });
    out.push({ label: `${n(a)} and ${n(b)} are siblings`, build: (bb) => void linkSiblings(bb, a.handle, b.handle) });
  }
  if ((p = pair("Person", "Family"))) {
    const [person, family] = p;
    out.push({ label: `${n(person)} is a parent in this family`, build: (bb) => setParent(bb, family.handle, person.handle) });
    out.push({ label: `${n(person)} is a child in this family`, build: (bb) => addChild(bb, family.handle, person.handle) });
  }
  if ((p = pair("Person", "Event"))) {
    const [person, event] = p;
    for (const [role, words] of ROLES) {
      out.push({ label: `${n(person)} ${words}`, build: (bb) => addEventRef(bb, person.handle, event.handle, role) });
    }
  }
  if ((p = pair("Family", "Event"))) {
    const [family, event] = p;
    out.push({ label: `It's this family's ${n(event).split(" of ")[0].toLowerCase()}`, build: (bb) => addEventRef(bb, family.handle, event.handle) });
  }
  if ((p = pair("Event", "Place"))) {
    const [event, place] = p;
    out.push({ label: `It happened at ${n(place)}`, build: (bb) => setEventPlace(bb, event.handle, place.handle) });
  }
  if ((p = pair("Citation", "Source"))) {
    const [citation, source] = p;
    out.push({ label: `The citation comes from ${n(source)}`, build: (bb) => setCitationSource(bb, citation.handle, source.handle) });
  }
  if ((p = pair("Source", "Repository"))) {
    const [source, repo] = p;
    out.push({ label: `The source is kept at ${n(repo)}`, build: (bb) => addRepoRef(bb, source.handle, repo.handle) });
  }
  for (const target of ["Person", "Family", "Event", "Place", "Media"] as GrampsClass[]) {
    if ((p = pair("Citation", target))) {
      const [citation, x] = p;
      out.push({ label: `It's evidence for ${n(x)}`, build: (bb) => cite(bb, x.handle, citation.handle) });
    }
  }
  for (const target of ["Person", "Family", "Event"] as GrampsClass[]) {
    if ((p = pair("Source", target))) {
      const [source, x] = p;
      out.push({ label: `It's evidence for ${n(x)} (adds a citation)`, build: (bb) => cite(bb, x.handle, newCitation(bb, source.handle)) });
    }
  }
  for (const target of ["Person", "Family", "Event", "Place", "Source", "Citation"] as GrampsClass[]) {
    if ((p = pair("Media", target))) {
      const [media, x] = p;
      const words = target === "Person" ? `It shows ${n(x)}` : target === "Source" ? `It's a copy of ${n(x)}` : `It's an image of ${n(x)}`;
      out.push({ label: words, build: (bb) => addMediaRef(bb, x.handle, media.handle) });
    }
  }
  if (a._class === "Note" || b._class === "Note") {
    const [note, x] = a._class === "Note" ? [a, b] : [b, a];
    if (x._class !== "Note" && x._class !== "Repository") {
      out.push({ label: `It's a note about ${n(x)}`, build: (bb) => attachNote(bb, x.handle, note.handle) });
    }
  }
  return out;
}

const NEW_TYPES: GrampsClass[] = ["Person", "Family", "Event", "Place", "Source", "Citation", "Repository", "Note"];

/** The kinds of new record that can be made already tied to `a` (yarn
 * pulled from its pin into empty board), with how many ways each can be tied. */
export function newTypesFor(records: Records, a: GrampsRecord): GrampsClass[] {
  return NEW_TYPES.filter((cls) => connectOptions(records, a, standIn(cls)).length > 0);
}

/** A placeholder record of `cls` for asking what it could be tied to. */
export function standIn(cls: GrampsClass): GrampsRecord {
  return { _class: cls, handle: "__new__", gramps_id: "" };
}

/** Takes away the link `yarn` stands for (both sides). */
export function snip(b: ChangeBuilder, yarn: Yarn): void {
  const other = yarn.a === yarn.owner ? yarn.b : yarn.a;
  switch (yarn.field) {
    case "father_handle":
      return removeParent(b, yarn.owner, "father");
    case "mother_handle":
      return removeParent(b, yarn.owner, "mother");
    case "child_ref_list":
      return removeChild(b, yarn.owner, other);
    case "event_ref_list":
      return removeEventRef(b, yarn.owner, other);
    case "place":
      return setEventPlace(b, yarn.owner, null);
    case "source_handle":
      return b.set(yarn.owner, "source_handle", null);
    case "reporef_list":
      return removeRepoRef(b, yarn.owner, other);
    case "citation_list":
      return uncite(b, yarn.owner, other);
    case "media_list":
      return removeMediaRef(b, yarn.owner, other);
    case "note_list":
      return detachNote(b, yarn.owner, other);
  }
}
