// How the Evidence Board reads its records: card titles and subtitles, and
// the yarn between cards. Pure functions over records in Gramps' internal
// form (records.ts), the same for every look of the board (skins).
//
// Yarn is never stored: it's worked out from the records' own fields each
// time, so a board always shows the tree as it is. Links that Gramps keeps
// on both records (a family's child list and the child's parent-family
// list) are drawn once, from the family's side.
import shapes from "../../data/grampsRecordShapes.json";
import type { GrampsRecord, GrampsTypeValue, Records } from "./records";

const TYPE_NAMES = shapes.type_names as Record<string, Record<string, string>>;

/** The English name of a Gramps type value (a custom one: its own text).
 * Callers translate it with t() like other Gramps vocabulary. */
export function typeName(type: unknown, typeClass: string): string {
  const t = type as GrampsTypeValue | undefined;
  if (!t) return "";
  if (t.string) return t.string;
  return TYPE_NAMES[typeClass]?.[String(t.value)] ?? "";
}

/** What kind of connection a piece of yarn is: its colour on the board.
 * Green is evidence and nothing else (the plan's rule). */
export type YarnKind = "kin" | "when" | "evidence" | "other";

export interface Yarn {
  /** Stable id: `owner|field|target`. */
  id: string;
  /** The two cards it ties (record handles). */
  a: string;
  b: string;
  kind: YarnKind;
  /** Short label for its tag, in English (translated by the caller). */
  label: string;
  /** Where the link is stored, for snipping it. */
  owner: string;
  field: string;
}

interface Ref {
  ref: string;
  role?: unknown;
  rect?: unknown;
}
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const refs = (v: unknown): Ref[] => list(v).filter((x): x is Ref => !!x && typeof x === "object" && typeof (x as Ref).ref === "string");
const handles = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === "string");

/** Every piece of yarn between two records that are both on the board. */
export function deriveYarn(records: Records, onBoard: Set<string>): Yarn[] {
  const out: Yarn[] = [];
  const add = (owner: string, field: string, a: string, b: string, kind: YarnKind, label: string) => {
    if (onBoard.has(a) && onBoard.has(b) && a !== b) out.push({ id: `${owner}|${field}|${a === owner ? b : a}`, a, b, kind, label, owner, field });
  };
  for (const h of onBoard) {
    const r = records[h];
    if (!r) continue;
    if (r._class === "Family") {
      if (typeof r.father_handle === "string") add(h, "father_handle", r.father_handle, h, "kin", "father");
      if (typeof r.mother_handle === "string") add(h, "mother_handle", r.mother_handle, h, "kin", "mother");
      for (const c of refs(r.child_ref_list)) add(h, "child_ref_list", c.ref, h, "kin", "child");
      for (const e of refs(r.event_ref_list)) add(h, "event_ref_list", h, e.ref, "when", typeName(records[e.ref]?.type, "EventType").toLowerCase() || "event");
    }
    if (r._class === "Person") {
      for (const e of refs(r.event_ref_list)) {
        const role = typeName(e.role, "EventRoleType");
        const event = typeName(records[e.ref]?.type, "EventType").toLowerCase() || "event";
        add(h, "event_ref_list", h, e.ref, "when", role === "Primary" ? event : role.toLowerCase() || event);
      }
    }
    if (r._class === "Event" && typeof r.place === "string") add(h, "place", h, r.place, "when", "happened at");
    if (r._class === "Citation" && typeof r.source_handle === "string") add(h, "source_handle", h, r.source_handle, "evidence", "from");
    if (r._class === "Source") for (const rr of refs(r.reporef_list)) add(h, "reporef_list", h, rr.ref, "evidence", "kept at");
    for (const c of handles(r.citation_list)) add(h, "citation_list", c, h, "evidence", "evidence");
    for (const m of refs(r.media_list)) add(h, "media_list", m.ref, h, "other", r._class === "Person" ? "shows" : "image of");
    for (const n of handles(r.note_list)) add(h, "note_list", n, h, "other", "note about");
  }
  return out;
}

// --- titles -------------------------------------------------------------------

function surnameOf(p: GrampsRecord | undefined): string {
  const name = p?.primary_name as { surname_list?: { surname?: string; primary?: boolean }[] } | undefined;
  return ((name?.surname_list ?? []).find((s) => s.primary)?.surname ?? name?.surname_list?.[0]?.surname ?? "").trim();
}

function personName(p: GrampsRecord | undefined): string {
  if (!p) return "";
  const first = (p.primary_name as { first_name?: string } | undefined)?.first_name;
  return [first, surnameOf(p)].filter(Boolean).join(" ");
}

function firstName(p: GrampsRecord | undefined): string {
  return (p?.primary_name as { first_name?: string } | undefined)?.first_name || personName(p);
}

/** A short date: the year, or the full date when day and month are known,
 * or a text-only date's own text. Board cards only need a glance; the full
 * editors show dates in the tree's own format. */
export function shortDate(date: unknown): string {
  const d = date as { dateval?: unknown[]; text?: string; modifier?: number } | undefined;
  if (!d) return "";
  const [day, month, year] = (d.dateval ?? []) as number[];
  if (!year) return d.text ?? "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return month && day ? `${year}-${pad(month)}-${pad(day)}` : String(year);
}

function yearOf(date: unknown): string {
  const year = ((date as { dateval?: unknown[] } | undefined)?.dateval ?? [])[2];
  return typeof year === "number" && year ? String(year) : "";
}

function lifespan(p: GrampsRecord, records: Records): string {
  const events = refs(p.event_ref_list);
  const at = (index: unknown) => (typeof index === "number" && index >= 0 ? records[events[index]?.ref] : undefined);
  const born = yearOf(at(p.birth_ref_index)?.date);
  const died = yearOf(at(p.death_ref_index)?.date);
  return born && died ? `${born}–${died}` : born ? `b. ${born}` : died ? `d. ${died}` : "";
}

function familyName(f: GrampsRecord, records: Records): string {
  const father = records[f.father_handle as string];
  const mother = records[f.mother_handle as string];
  if (father && mother) {
    // Each partner keeps their own recorded surname: never give one
    // partner the other's. Only when both recorded the same surname is it
    // shared, as in "John & Ruth Miller".
    const surname = surnameOf(father);
    if (surname && surname === surnameOf(mother)) return `${firstName(father)} & ${firstName(mother)} ${surname}`;
    return `${personName(father) || "Unnamed person"} & ${personName(mother) || "Unnamed person"}`;
  }
  if (father || mother) return `${personName(father ?? mother)}'s family`;
  return "Family";
}

/** Who an event belongs to, among the records on the board. */
function eventHolders(handle: string, records: Records): string {
  const all = Object.values(records);
  const family = all.find((r) => r._class === "Family" && refs(r.event_ref_list).some((e) => e.ref === handle));
  if (family) {
    const names = [records[family.father_handle as string], records[family.mother_handle as string]].filter(Boolean).map(firstName);
    return names.join(" & ");
  }
  const primary = all.find((r) => r._class === "Person" && refs(r.event_ref_list).some((e) => e.ref === handle && typeName(e.role, "EventRoleType") === "Primary"));
  return primary ? firstName(primary) : "";
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A record's card title, e.g. "Ruth Carter", "Marriage of John & Ruth". */
export function titleOf(handle: string, records: Records): string {
  const r = records[handle];
  if (!r) return "";
  switch (r._class) {
    case "Person":
      return personName(r) || "Unnamed person";
    case "Family":
      return familyName(r, records);
    case "Event": {
      const type = typeName(r.type, "EventType") || "Event";
      const who = eventHolders(handle, records);
      return who ? `${type} of ${who}` : (r.description as string) || type;
    }
    case "Place":
      return (r.name as { value?: string } | undefined)?.value || (r.title as string) || "Unnamed place";
    case "Source":
      return (r.title as string) || "Untitled source";
    case "Citation": {
      const source = records[r.source_handle as string];
      return (r.page as string) || (source ? `Citation of ${source.title as string}` : "Citation");
    }
    case "Repository":
      return (r.name as string) || "Unnamed repository";
    case "Media":
      return (r.desc as string) || (r.path as string) || "Photo";
    case "Note":
      return truncate(((r.text as { string?: string } | undefined)?.string ?? "").trim(), 60) || "Empty note";
  }
}

/** A record's card subtitle: lifespan, date and place, author... */
export function subtitleOf(handle: string, records: Records): string {
  const r = records[handle];
  if (!r) return "";
  switch (r._class) {
    case "Person":
      return lifespan(r, records);
    case "Event": {
      const place = records[r.place as string];
      return [shortDate(r.date), place ? titleOf(place.handle, records) : ""].filter(Boolean).join(" · ");
    }
    case "Place":
      return typeName(r.place_type, "PlaceType");
    case "Source":
      return (r.author as string) || "";
    case "Citation": {
      const source = records[r.source_handle as string];
      return source && r.page ? (source.title as string) : "";
    }
    case "Repository":
      return typeName(r.type, "RepositoryType");
    case "Media":
      return shortDate(r.date);
    default:
      return "";
  }
}

/** An event with no citation, on the board: stamped UNPROVEN. */
export function isUnproven(record: GrampsRecord | undefined): boolean {
  return !!record && record._class === "Event" && handles(record.citation_list).length === 0;
}

/** A person's or family's events that nothing supports yet (no citation):
 * the board circles their count on the card. Only events in `records` are
 * counted, so ones not loaded (or private) are left out rather than guessed. */
export function unprovenEventsOf(record: GrampsRecord | undefined, records: Records): string[] {
  if (!record || (record._class !== "Person" && record._class !== "Family")) return [];
  const out: string[] = [];
  for (const e of refs(record.event_ref_list)) {
    if (!out.includes(e.ref) && isUnproven(records[e.ref])) out.push(e.ref);
  }
  return out;
}

const BIRTHS = ["Birth", "Baptism", "Christening"];
const DEATHS = ["Death", "Burial", "Cremation"];
const MARRIAGES = ["Marriage", "Alternate Marriage", "Marriage Banns", "Marriage License", "Marriage Contract", "Marriage Settlement"];
/** Born this many years ago, someone has surely died. */
const SURELY_DEAD = 110;

/** What's still to find for a record on the board, in the spirit of Gramps'
 * What's Next gramplet but only for this record: a person's names, birth,
 * death and parents; a family's partners and marriage; an event's date and
 * place. Short English phrases, translated by the caller. Checks that need
 * the record's events are skipped until all of them are in `records`, so a
 * private or not-yet-loaded event is never reported missing. */
export function whatsMissing(record: GrampsRecord | undefined, records: Records, thisYear = new Date().getFullYear()): string[] {
  if (!record) return [];
  const out: string[] = [];
  const own = refs(record.event_ref_list);
  const allLoaded = own.every((e) => records[e.ref]);
  /** Types of the events this record is the main subject of. */
  const types = own
    .filter((e) => ["", "Primary", "Family"].includes(typeName(e.role, "EventRoleType")))
    .map((e) => typeName(records[e.ref]?.type, "EventType"));
  switch (record._class) {
    case "Person": {
      const name = record.primary_name as { first_name?: string; surname_list?: { surname?: string }[] } | undefined;
      if (!name?.first_name?.trim()) out.push("first name");
      if (!(name?.surname_list ?? []).some((s) => s.surname?.trim())) out.push("surname");
      if (allLoaded) {
        if (!types.some((x) => BIRTHS.includes(x))) out.push("birth");
        const born = own
          .filter((e) => BIRTHS.includes(typeName(records[e.ref]?.type, "EventType")))
          .map((e) => Number(yearOf(records[e.ref].date)))
          .filter(Boolean);
        if (born.length && thisYear - Math.min(...born) >= SURELY_DEAD && !types.some((x) => DEATHS.includes(x))) out.push("death");
      }
      if (!handles(record.parent_family_list).length) out.push("parents");
      break;
    }
    case "Family": {
      if (!record.father_handle !== !record.mother_handle) out.push("other partner");
      if (allLoaded && typeName(record.type, "FamilyRelType") !== "Unmarried" && !types.some((x) => MARRIAGES.includes(x))) out.push("marriage");
      break;
    }
    case "Event": {
      const date = record.date as { text?: string } | undefined;
      if (!yearOf(record.date) && !date?.text?.trim()) out.push("date");
      if (!record.place) out.push("place");
      break;
    }
  }
  return out;
}

/** A photo with no date: the board pencils "date?" on it. */
export function isUndatedPhoto(record: GrampsRecord | undefined): boolean {
  return !!record && record._class === "Media" && !yearOf(record.date) && !(record.date as { text?: string } | undefined)?.text;
}

/** The extra lines a card shows at its largest size ("dossier"): dates,
 * family, people, evidence. Only what the board has loaded is named. */
export function detailsOf(handle: string, records: Records): string[] {
  const r = records[handle];
  if (!r) return [];
  const out: string[] = [];
  const named = (hs: string[]) => hs.filter((h) => records[h]).map((h) => titleOf(h, records)).join(", ");
  const families = Object.values(records).filter((x) => x._class === "Family");
  switch (r._class) {
    case "Person": {
      for (const e of refs(r.event_ref_list)) {
        const event = records[e.ref];
        if (!event) continue;
        const role = typeName(e.role, "EventRoleType");
        const place = records[event.place as string];
        const what = typeName(event.type, "EventType") + (role && role !== "Primary" ? ` (${role.toLowerCase()})` : "");
        out.push(`${what}: ${[shortDate(event.date) || "no date", place ? titleOf(place.handle, records) : ""].filter(Boolean).join(", ")}`);
      }
      const parents = families.filter((f) => refs(f.child_ref_list).some((c) => c.ref === handle)).flatMap((f) => [f.father_handle, f.mother_handle]).filter((h): h is string => typeof h === "string");
      if (named(parents)) out.push(`Parents: ${named(parents)}`);
      const own = families.filter((f) => f.father_handle === handle || f.mother_handle === handle);
      const partners = own.map((f) => (f.father_handle === handle ? f.mother_handle : f.father_handle)).filter((h): h is string => typeof h === "string");
      if (named(partners)) out.push(`Partner: ${named(partners)}`);
      const children = own.flatMap((f) => refs(f.child_ref_list).map((c) => c.ref));
      if (named(children)) out.push(`Children: ${named(children)}`);
      break;
    }
    case "Family": {
      // A family group sheet lists the whole family, pinned or not: the
      // caller passes the members' records too (BoardView loads them).
      if (named(handles([r.father_handle]))) out.push(`Father: ${named(handles([r.father_handle]))}`);
      if (named(handles([r.mother_handle]))) out.push(`Mother: ${named(handles([r.mother_handle]))}`);
      const children = refs(r.child_ref_list).map((c) => c.ref);
      const unseen = children.filter((h) => !records[h]).length;
      if (children.length) out.push(`Children: ${[named(children), unseen ? `${unseen} you can't see` : ""].filter(Boolean).join(", ")}`);
      for (const e of refs(r.event_ref_list)) {
        const event = records[e.ref];
        if (event) out.push(`${typeName(event.type, "EventType")}: ${shortDate(event.date) || "no date"}`);
      }
      break;
    }
    case "Event": {
      const people = Object.values(records)
        .filter((x) => x._class === "Person" && refs(x.event_ref_list).some((e) => e.ref === handle))
        .map((p) => titleOf(p.handle, records));
      if (people.length) out.push(`People: ${people.join(", ")}`);
      if (r.description) out.push(String(r.description));
      break;
    }
    case "Source": {
      const repos = refs(r.reporef_list).map((x) => x.ref);
      if (named(repos)) out.push(`Kept at: ${named(repos)}`);
      break;
    }
    case "Citation": {
      const cited = Object.values(records).filter((x) => handles(x.citation_list).includes(handle)).map((x) => titleOf(x.handle, records));
      if (cited.length) out.push(`Evidence for: ${cited.join(", ")}`);
      break;
    }
    case "Media": {
      const shown = Object.values(records).filter((x) => refs(x.media_list).some((m) => m.ref === handle)).map((x) => titleOf(x.handle, records));
      if (shown.length) out.push(`Shows: ${shown.join(", ")}`);
      break;
    }
    case "Note":
      return (((r.text as { string?: string } | undefined)?.string ?? "").trim()).split(/\n+/).slice(0, 8);
  }
  if (["Person", "Family", "Event"].includes(r._class)) {
    const all = handles(r.citation_list);
    const shown = all.filter((c) => records[c]).map((c) => titleOf(records[c].source_handle as string, records) || titleOf(c, records));
    const others = all.length - shown.length;
    if (!all.length) out.push("Evidence: none yet");
    else out.push(`Evidence: ${[...shown, others ? `${others} more not on the board` : ""].filter(Boolean).join("; ")}`);
  }
  return out;
}

/** A record's direct links to other records, read from its own fields: the
 * card panel's "Leads" (with Pin up for the ones not on the board yet). */
export interface Lead {
  handle: string;
  cls: GrampsRecord["_class"];
  /** How it's linked, in English, e.g. "parents' family", "event", "evidence". */
  how: string;
}

export function leadsOf(record: GrampsRecord): Lead[] {
  const out: Lead[] = [];
  const add = (handle: unknown, cls: GrampsRecord["_class"], how: string) => {
    if (typeof handle === "string" && handle && !out.some((l) => l.handle === handle)) out.push({ handle, cls, how });
  };
  switch (record._class) {
    case "Person":
      for (const f of handles(record.parent_family_list)) add(f, "Family", "parents' family");
      for (const f of handles(record.family_list)) add(f, "Family", "own family");
      for (const e of refs(record.event_ref_list)) add(e.ref, "Event", "event");
      break;
    case "Family":
      add(record.father_handle, "Person", "father");
      add(record.mother_handle, "Person", "mother");
      for (const c of refs(record.child_ref_list)) add(c.ref, "Person", "child");
      for (const e of refs(record.event_ref_list)) add(e.ref, "Event", "event");
      break;
    case "Event":
      add(record.place, "Place", "place");
      break;
    case "Citation":
      add(record.source_handle, "Source", "source");
      break;
    case "Source":
      for (const r of refs(record.reporef_list)) add(r.ref, "Repository", "kept at");
      break;
  }
  for (const c of handles(record.citation_list)) add(c, "Citation", "evidence");
  for (const m of refs(record.media_list)) add(m.ref, "Media", "photo");
  for (const n of handles(record.note_list)) add(n, "Note", "note");
  return out;
}

/** A person's associations (Gramps' person_ref_list): other people tied to
 * them by a described relationship, e.g. "Godfather", "Witness", "Neighbor". */
export interface Association {
  handle: string;
  /** The relationship as typed in the tree (free text, may be empty). */
  rel: string;
}

export function associationsOf(record: GrampsRecord): Association[] {
  if (record._class !== "Person") return [];
  const out: Association[] = [];
  for (const p of refs(record.person_ref_list)) {
    const raw = (p as { rel?: unknown }).rel;
    const rel = typeof raw === "string" ? raw.trim() : "";
    if (p.ref !== record.handle && !out.some((a) => a.handle === p.ref && a.rel === rel)) out.push({ handle: p.ref, rel });
  }
  return out;
}
