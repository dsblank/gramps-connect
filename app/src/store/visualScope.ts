// Turns a routed VisualSubject ("this person", "this place") into the sets
// of event and place handles the Map and the Timeline should plot for it.
//
// Every branch here answers from the local caches -- no request, no await
// once the relevant stores are loaded -- which is the whole reason the
// hidden `event_refs`/`father_handle`/`mother_handle`/`enclosed_by` columns
// exist in views.ts. A person's events are not derivable from the Events
// cache alone (an Event points forward to its place, never back to its
// participants), so before those columns the only way to answer "which
// events are Bob's" was fetchObjectExtended -- one round trip per click,
// per reload and per shared link, and nothing at all offline. Now it's a
// primary-key lookup.
//
// What the two visuals then *do* with these sets is their own business:
// filter down to them, or draw the whole tree and highlight them. See each
// view's DEFAULT_MODE table.
import type { VisualSubject } from "../hash";
import { getViewStore } from "./registry";
import type { VisualData } from "./visualData";
import { formatEventType, parseHandleList } from "./views";

export interface ResolvedScope {
  subject: VisualSubject;
  /** How to name this subject in the scope chip -- the record's own display
   * name, read from the same cached columns its table column shows. */
  label: string;
  /** The events to plot. Empty is a legitimate answer (a person with no
   * events recorded), and the views say so rather than showing nothing. */
  eventHandles: Set<string>;
  /** The places to plot: for a person or family, wherever their events
   * happened; for a place, itself and everything inside it. */
  placeHandles: Set<string>;
}

/** Which view stores a subject type needs loaded before it can be resolved.
 * The Places and Events caches are always loaded by useVisualData itself --
 * they're what the visuals plot -- so these are the *extra* ones.
 *
 * A family needs the person cache as well as its own: its scope includes
 * the couple's events, which live on their Person rows. That the store may
 * be a several-thousand-row download on a cold session is the accepted cost
 * of the local-first choice -- and in the common path (clicking the button
 * from the People view) it's already loaded; only a pasted link pays, and
 * pays exactly what visiting that view would have. */
const REQUIRED_STORES: Record<string, string[]> = {
  person: ["person"],
  family: ["family", "person"],
  event: [],
  place: [],
};

export function storesNeededFor(subject: VisualSubject | null): string[] {
  if (!subject) return [];
  return REQUIRED_STORES[subject.type] ?? [];
}

/** Loads whatever `subject` needs beyond the Places/Events caches. Safe to
 * call repeatedly -- ensureLoaded is a no-op once a store is loaded. */
export async function loadScopeStores(subject: VisualSubject | null): Promise<void> {
  await Promise.all(storesNeededFor(subject).map((key) => getViewStore(key).ensureLoaded()));
}

/** The scope for `subject`, or null when it can't be resolved yet or at all
 * -- the store isn't loaded, or the handle names a record this cache
 * doesn't have (a stale link, or a background fill that hasn't reached it).
 * Callers treat null as "no scope" and show the whole tree, which is the
 * honest fallback: better a correct unscoped map than a confidently empty
 * scoped one. */
export function resolveScope(subject: VisualSubject, data: VisualData): ResolvedScope | null {
  switch (subject.type) {
    case "person": return resolvePerson(subject, data);
    case "family": return resolveFamily(subject, data);
    case "event": return resolveEvent(subject, data);
    case "place": return resolvePlace(subject, data);
    default: return null;
  }
}

/** A person's own events -- their `event_ref_list`, nothing more. Family
 * events (the marriage) and children's births are deliberately excluded:
 * "own events only" keeps the scope exactly what the Events section of that
 * person's own detail panel already lists, so the map and the panel never
 * disagree about what counts as theirs. `family_list` is cached against
 * widening this later without a second forced refetch. */
function resolvePerson(subject: VisualSubject, data: VisualData): ResolvedScope | null {
  const row = getViewStore("person").readRowByHandle(subject.handle, [
    "given_name", "surname", "event_refs",
  ]);
  if (!row) return null;
  const [given, surname, eventRefs] = row as [string | null, string | null, string | null];
  const eventHandles = new Set(parseHandleList(eventRefs));
  return {
    subject,
    label: [given, surname].filter(Boolean).join(" ") || "(unnamed person)",
    eventHandles,
    placeHandles: placesOfEvents(eventHandles, data),
  };
}

/** The family's own events *plus* both parents'. A family's own
 * event_ref_list is usually just the Marriage, so a scope built from it
 * alone would put one dot on the timeline and one marker on the map --
 * degenerate in exactly the way a single Event is, and not what anyone
 * means by "this family on a timeline". The children are left out on the
 * same principle the person scope follows: this is the couple's record, and
 * each child has a button of their own. */
function resolveFamily(subject: VisualSubject, data: VisualData): ResolvedScope | null {
  const row = getViewStore("family").readRowByHandle(subject.handle, [
    "father_name", "mother_name", "event_refs", "father_handle", "mother_handle",
  ]);
  if (!row) return null;
  const [fatherJson, motherJson, eventRefs, fatherHandle, motherHandle] = row as [
    string | null, string | null, string | null, string | null, string | null,
  ];

  const eventHandles = new Set(parseHandleList(eventRefs));
  const personStore = getViewStore("person");
  for (const parent of [fatherHandle, motherHandle]) {
    if (!parent) continue;
    const parentRow = personStore.readRowByHandle(parent, ["event_refs"]);
    if (!parentRow) continue;
    for (const handle of parseHandleList(parentRow[0] as string | null)) eventHandles.add(handle);
  }

  const names = [nameOf(fatherJson), nameOf(motherJson)].filter(Boolean);
  return {
    subject,
    label: names.length > 0 ? names.join(" & ") : "(family)",
    eventHandles,
    placeHandles: placesOfEvents(eventHandles, data),
  };
}

/** A single event: itself, and wherever it happened. Both visuals treat
 * this as a locate-in-context rather than a filter (one dot and one marker
 * say nothing on their own) -- see their DEFAULT_MODE tables. */
function resolveEvent(subject: VisualSubject, data: VisualData): ResolvedScope | null {
  const row = getViewStore("event").readRowByHandle(subject.handle, ["event_type", "place_title"]);
  if (!row) return null;
  const [typeJson, placeTitle] = row as [string | null, string | null];
  const eventHandles = new Set([subject.handle]);
  return {
    subject,
    // formatEventType takes the raw stored struct -- so this is the same
    // text the Events table's own Type column shows for this row.
    label: [formatEventType(typeJson), placeTitle].filter(Boolean).join(" — ") || "(event)",
    eventHandles,
    placeHandles: placesOfEvents(eventHandles, data),
  };
}

/** A place, everything enclosed by it (transitively), and every event at
 * any of them. The descent is the point: Gramps records an event against
 * the most specific place it knows, so a county's own event list is
 * typically empty while the towns inside it carry everything. */
function resolvePlace(subject: VisualSubject, data: VisualData): ResolvedScope | null {
  const row = getViewStore("place").readRowByHandle(subject.handle, ["title"]);
  if (!row) return null;

  const placeHandles = new Set<string>([subject.handle]);
  // Breadth-first over childPlaces. `placeHandles` doubles as the visited
  // set, so a cyclic containment (which Gramps doesn't forbid at the data
  // level) terminates instead of hanging the tab.
  const queue = [subject.handle];
  while (queue.length > 0) {
    for (const child of data.childPlaces.get(queue.shift()!) ?? []) {
      if (placeHandles.has(child)) continue;
      placeHandles.add(child);
      queue.push(child);
    }
  }

  const eventHandles = new Set<string>();
  for (const place of placeHandles) {
    for (const event of data.eventsByPlace.get(place) ?? []) eventHandles.add(event);
  }

  return {
    subject,
    label: (row[0] as string | null) || "(untitled place)",
    eventHandles,
    placeHandles,
  };
}

/** Where a set of events happened. Events with no place contribute nothing
 * -- they're still in the timeline's half of the scope, just not the map's,
 * which is why the two sets are tracked separately rather than one being
 * derived from the other at the point of use. */
function placesOfEvents(eventHandles: Set<string>, data: VisualData): Set<string> {
  const places = new Set<string>();
  for (const event of eventHandles) {
    const place = data.placeOfEvent.get(event);
    if (place) places.add(place);
  }
  return places;
}

/** A stored primary_name struct as display text -- the same shape (and the
 * same first-surname-only simplification) FAMILY_VIEW's own Father/Mother
 * columns render, so the chip agrees with the table the user came from. */
function nameOf(json: string | null): string {
  if (!json) return "";
  const name = JSON.parse(json) as { first_name?: string; surname_list?: { surname?: string }[] };
  return [name.first_name, name.surname_list?.[0]?.surname].filter(Boolean).join(" ");
}
