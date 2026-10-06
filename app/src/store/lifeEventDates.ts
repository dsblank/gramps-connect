// Birth/death/marriage dates (and places) for chart labels (Tree, Fan, Family graph) and search
// snippets, formatted per the tree's display settings rather than taken
// from gramps-web-api's `profile.birth.date` -- that string is formatted
// with the *server's* preferences.date-format, which no request can change.
//
// The person JSON those callers already have carries the raw event refs
// (event_ref_list + birth_ref_index/death_ref_index), and the Events cache
// has each event's raw date, so the date can be re-formatted locally. The
// event is picked the way the profile picks it -- gramps' own
// get_birth_or_fallback/get_death_or_fallback (gen/utils/db.py): the
// birth/death ref, else the first primary-role fallback event (baptism,
// christening, burial, ...). When that event isn't cached (Events not
// loaded yet, or not reached by a background fill), the server's string is
// used as before.
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { getViewStore } from "./registry";
import { displayPlaceTitle, formatDisplayDate } from "./placeIndex";

// gen/lib/eventtype.py / eventroletype.py values.
const MARRIAGE = 1;
const BIRTH_FALLBACK = new Set([45, 15, 22]); // STILLBIRTH, BAPTISM, CHRISTEN
const DEATH_FALLBACK = new Set([45, 19, 24, 20, 39]); // STILLBIRTH, BURIAL, CREMATION, CAUSE_DEATH, PROBATE
const MARRIAGE_FALLBACK = new Set([6, 10]); // ENGAGEMENT, MARR_ALT
const ROLE_PRIMARY = 1, ROLE_FAMILY = 8;

type Which = "birth" | "death" | "marriage";

interface ObjectWithEvents {
  event_ref_list?: { ref?: string; role?: { value?: number } | number }[];
  birth_ref_index?: number;
  death_ref_index?: number;
  profile?: Partial<Record<Which, { date?: string; place?: string }>>;
}

interface CachedEvent {
  date: GrampsDate | null;
  type: number | null;
  place: string | null;
}

let eventLoadRequested = false;

function roleValue(role: { value?: number } | number | undefined): number | undefined {
  return typeof role === "number" ? role : role?.value;
}

function readEvent(handle: string): CachedEvent | null {
  const row = getViewStore("event").readRowByHandle(handle, ["date", "event_type", "place"]);
  if (!row) return null;
  const [dateJson, typeJson, place] = row as [string | null, string | null, string | null];
  try {
    return {
      date: dateJson ? (JSON.parse(dateJson) as GrampsDate) : null,
      type: typeJson ? ((JSON.parse(typeJson) as { value?: number }).value ?? null) : null,
      place: place || null,
    };
  } catch {
    return null;
  }
}

/** The event the server's profile shows for `which`, read from the Events
 * cache -- `null` when that can't be determined locally (the caller keeps
 * the server's text), `"none"` when the object has no such event. */
function resolveEvent(obj: ObjectWithEvents, which: Which): CachedEvent | "none" | null {
  const refs = obj.event_ref_list;
  // Not in the JSON at all (the caller fetched a subset of keys): nothing
  // to go on locally.
  if (!refs) return null;
  if (!refs.length) return "none";

  const store = getViewStore("event");
  if (!store.getSnapshot().loadedCount) {
    if (!eventLoadRequested) {
      eventLoadRequested = true;
      store.ensureLoaded().catch(() => {
        eventLoadRequested = false;
      });
    }
    return null;
  }

  // Every candidate has to be readable, or we can't know which one the
  // server picked -- bail out to its text rather than guess.
  const events: (CachedEvent | null)[] = refs.map((ref) => (ref.ref ? readEvent(ref.ref) : null));
  if (events.some((event, i) => !event && refs[i].ref)) return null;

  if (which === "marriage") {
    // get_marriage_or_fallback: the first MARRIAGE event, else the first
    // primary/family-role ENGAGEMENT or alternate marriage.
    const marriage = events.find((event) => event?.type === MARRIAGE);
    if (marriage) return marriage;
    const fallback = events.find(
      (event, i) =>
        event && event.type !== null && MARRIAGE_FALLBACK.has(event.type) &&
        [ROLE_PRIMARY, ROLE_FAMILY].includes(roleValue(refs[i].role) ?? -1),
    );
    return fallback ?? "none";
  }

  // get_birth_or_fallback / get_death_or_fallback: the birth/death ref,
  // else the first primary-role fallback event.
  const index = which === "birth" ? obj.birth_ref_index : obj.death_ref_index;
  if (index !== undefined && index >= 0 && events[index]) return events[index]!;
  const fallbackTypes = which === "birth" ? BIRTH_FALLBACK : DEATH_FALLBACK;
  const fallback = events.find(
    (event, i) => event && event.type !== null && fallbackTypes.has(event.type) && roleValue(refs[i].role) === ROLE_PRIMARY,
  );
  return fallback ?? "none";
}

/** A person's birth/death or a family's marriage date as display text, ""
 * when there's none. */
export function lifeEventDate(obj: ObjectWithEvents | null | undefined, which: Which): string {
  if (!obj) return "";
  const event = resolveEvent(obj, which);
  if (event === null) return obj.profile?.[which]?.date ?? "";
  return event === "none" ? "" : formatDisplayDate(event.date);
}

/** Same event's place, as the display settings say to title it. */
export function lifeEventPlace(obj: ObjectWithEvents | null | undefined, which: Which): string {
  if (!obj) return "";
  const serverText = obj.profile?.[which]?.place ?? "";
  const event = resolveEvent(obj, which);
  if (event === null) return serverText;
  if (event === "none" || !event.place) return "";
  return displayPlaceTitle(event.place, event.date) ?? serverText;
}
