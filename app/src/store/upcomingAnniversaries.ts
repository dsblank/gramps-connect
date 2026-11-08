// Home's "Anniversaries" card: the births, marriages and deaths whose day
// and month fall in a 7-day window -- from today at first, then (with the
// card's arrows) the week before or after that, and so on. When the week
// holds more than the card shows, the most recent events win the places,
// so a sister's 14th wedding anniversary beats a death from 1890; the ones
// picked are then listed soonest first.
//
// gramps-web's own dashboard card (GrampsjsViewAnniversaries.js) only shows
// *today*, via /api/events/?dates=*/m/d. A window needs a month/day range
// instead, which that endpoint can't express, so this is a GOQL query on the
// event table. Like the ICS feed (gramps-web-api's /api/anniversaries.ics),
// only exact dates count: no about/before/after/range, no estimated or
// calculated quality, and a known day and month. Unlike it, only the
// Gregorian calendar (converting a Julian or Hebrew date's day and month
// would need doing in SQL to filter on).
import { fetchPage } from "./api";
import { EVENT_VIEW, type OrderBy } from "./views";
import { fetchObjectsByHandle, type RawRecord } from "./objectsByHandle";
import { getI18nSnapshot } from "../i18n/i18n";
import { DEFAULT_MAX_AGE_PROB_ALIVE } from "./displaySettings";
import { STORAGE_KEYS } from "./storageKeys";

/** Days in one window of the card. */
export const WINDOW_DAYS = 7;

export interface AnniversaryItem {
  /** The event's own handle. */
  eventHandle: string;
  /** Where the row links: the person (or family, for a marriage) the event
   * belongs to, or the event itself when it has no participant. */
  viewKey: "person" | "family" | "event";
  handle: string;
  /** "Birth", "Marriage", ... in the UI language (the server's profile). */
  typeLabel: string;
  /** Who: the person's name, or "father & mother" for a family. */
  who: string;
  /** The full date as the server displays it, e.g. "1850-11-03". */
  dateLabel: string;
  /** Days from today to this occurrence: 0 = today, 1 = tomorrow, -1 =
   * yesterday, ... */
  daysUntil: number;
  /** How many years this occurrence marks, or null when the year isn't
   * recorded. */
  years: number | null;
}

export interface AnniversaryWindow {
  /** First and last day of the window, inclusive, at local midnight. */
  start: Date;
  end: Date;
  /** The most recent `limit` events in it. */
  items: AnniversaryItem[];
  /** How many more the window holds than `items`: a count, or null when
   * there may be more but it isn't known how many (Only living stops
   * looking once the card is full, since what's left would each need its
   * profile fetched to tell). */
  more: number | null;
}

export interface AnniversaryOptions {
  /** Leave out anyone who has died: no deaths, a birth only when that
   * person is living, a marriage only when both spouses are. */
  onlyLiving?: boolean;
  /** For onlyLiving: someone with no death recorded but born more than
   * this many years ago counts as dead too (the Preferences' Living age
   * limit, Gramps' behavior.max-age-prob-alive). */
  maxAge?: number;
}

const BASE_EXPR =
  "type.value in [EventType.BIRTH, EventType.DEATH, EventType.MARRIAGE]" +
  " and date.modifier == Date.MOD_NONE and date.quality == Date.QUAL_NONE" +
  " and date.calendar == Date.CAL_GREGORIAN" +
  " and date.dateval[0] > 0 and date.dateval[1] > 0";

/** Which events win the card's places: most recent year first, a yearless
 * date (year 0) last. Then by day. (Display order is fetchAnniversaryWindow's
 * own: soonest first.) */
const ORDER: OrderBy[] = [
  { column: "date.dateval[2]", direction: "desc" },
  { column: "date.dateval[1]", direction: "asc" },
  { column: "date.dateval[0]", direction: "asc" },
];

const DAY_MS = 86_400_000;

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** Whole days from a to b. Math.round: a daylight-saving change makes one
 * day 23 or 25 hours. */
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Window `index` around `today`: 0 is today and the 6 days after, 1 the
 * 7 after those, -1 the 7 days up to yesterday, ... */
export function windowRange(index: number, today: Date): { start: Date; end: Date } {
  const start = addDays(midnight(today), index * WINDOW_DAYS);
  return { start, end: addDays(start, WINDOW_DAYS - 1) };
}

function onOrAfter(month: number, day: number): string {
  return `(date.dateval[1] > ${month} or (date.dateval[1] == ${month} and date.dateval[0] >= ${day}))`;
}

function onOrBefore(month: number, day: number): string {
  return `(date.dateval[1] < ${month} or (date.dateval[1] == ${month} and date.dateval[0] <= ${day}))`;
}

/** The where_expr for events whose day and month fall from `start` through
 * `end` (at most a year apart). A window over New Year is two pieces, one
 * per calendar year. Each piece leaves out events dated after its year:
 * nothing has happened yet to have an anniversary of. A yearless date
 * (year 0) passes.
 *
 * For Only living, `living` leaves out deaths, and any event dated before
 * `living.fromYear` (more than the living age limit ago, so whoever it's
 * about has died, by the same rule as a birth that long ago). A yearless
 * date still passes. */
export function windowExpr(start: Date, end: Date, living: { fromYear: number } | null = null): string {
  const piece = (year: number, from: string, to: string) => `(date.dateval[2] <= ${year} and ${from} and ${to})`;
  const sm = start.getMonth() + 1, sd = start.getDate();
  const em = end.getMonth() + 1, ed = end.getDate();
  const pieces = start.getFullYear() === end.getFullYear()
    ? [piece(start.getFullYear(), onOrAfter(sm, sd), onOrBefore(em, ed))]
    : [piece(start.getFullYear(), onOrAfter(sm, sd), onOrBefore(12, 31)),
      piece(end.getFullYear(), onOrAfter(1, 1), onOrBefore(em, ed))];
  const types = living
    ? ` and type.value != EventType.DEATH and (date.dateval[2] == 0 or date.dateval[2] >= ${living.fromYear})`
    : "";
  return `${BASE_EXPR}${types} and (${pieces.join(" or ")})`;
}

/** The (month, day)'s occurrence within [start, end], and its year. 29
 * February in a year without one falls on 1 March, as JS Date rolls it. */
export function occurrenceIn(month: number, day: number, start: Date, end: Date): Date {
  for (const year of [start.getFullYear(), end.getFullYear()]) {
    const date = new Date(year, month - 1, day);
    if (date >= start && date <= end) return date;
  }
  // Only a 29 February rolled past the window's end: the nearest day.
  return new Date(end.getFullYear(), month - 1, day) > end ? end : start;
}

type Profile = Record<string, any>;

function personName(p: Profile | undefined): string {
  return p?.name_display || [p?.name_given, p?.name_surname].filter(Boolean).join(" ");
}

/** The row's link target and "who" label, from the event's profile. */
function participant(profile: Profile | undefined): Pick<AnniversaryItem, "viewKey" | "handle" | "who"> | null {
  const person = profile?.participants?.people?.[0]?.person;
  if (person?.handle) return { viewKey: "person", handle: person.handle, who: personName(person) };
  const family = profile?.participants?.families?.[0]?.family;
  if (family?.handle) {
    const who = [family.father, family.mother].map(personName).filter(Boolean).join(" & ");
    return { viewKey: "family", handle: family.handle, who };
  }
  return null;
}

/** The year in a profile's display date ("1850-11-03", "3 Nov 1850",
 * "about 1850"): the last run of four digits, or null. A profile only
 * carries the date as the server displays it, in whichever date format
 * its gramps.ini sets, so this reads it back rather than a dateval. */
export function displayYear(date: unknown): number | null {
  const years = typeof date === "string" ? date.match(/\d{4}/g) : null;
  return years ? Number(years[years.length - 1]) : null;
}

/** Whether this person (a participant profile) counts as dead: a death,
 * or the burial or cremation gramps-web-api falls back to, is recorded
 * (their profile's `death` isn't empty), or their birth (or the baptism
 * or christening it falls back to) was more than `maxAge` years before
 * `year`. No birth year, no death: living. */
function hasDied(person: Profile | undefined, maxAge: number, year: number): boolean {
  if (!person) return false;
  if (person.death && Object.keys(person.death).length > 0) return true;
  const born = displayYear(person.birth?.date);
  return born !== null && year - born > maxAge;
}

/** For Only living: the event's person (or, for a marriage, both spouses)
 * is living (hasDied()). GOQL can't ask this in the query: `backlinks`
 * (event -> person) only tests the referrer's class, not its fields, so
 * it's the participant profiles fetched for the rows that tell. An event
 * with no participant can't be shown to be about the living, so it's out. */
export function isAboutTheLiving(event: RawRecord, maxAge = DEFAULT_MAX_AGE_PROB_ALIVE, year = new Date().getFullYear()): boolean {
  const profile = event.profile as Profile | undefined;
  const person = profile?.participants?.people?.[0]?.person;
  if (person?.handle) return !hasDied(person, maxAge, year);
  const family = profile?.participants?.families?.[0]?.family;
  if (family?.handle) return !hasDied(family.father, maxAge, year) && !hasDied(family.mother, maxAge, year);
  return false;
}

function toItem(event: RawRecord, start: Date, end: Date, today: Date): AnniversaryItem {
  const profile = event.profile as Profile | undefined;
  const [day, month, year] = ((event.date as Profile | undefined)?.dateval ?? []) as number[];
  const occurrence = occurrenceIn(month, day, start, end);
  const who = participant(profile);
  const years = occurrence.getFullYear() - year;
  return {
    eventHandle: event.handle,
    viewKey: who?.viewKey ?? "event",
    handle: who?.handle ?? event.handle,
    typeLabel: String(profile?.type ?? ""),
    who: who?.who ?? "",
    dateLabel: String(profile?.date ?? ""),
    daysUntil: daysBetween(midnight(today), occurrence),
    years: year > 0 && years > 0 ? years : null,
  };
}

/** With Only living, rows are fetched this many at a time until the card
 * is full, since some of each batch get left out. */
const LIVING_BATCH = 25;

/** The most recent `limit` anniversaries in window `index` (see
 * windowRange()), listed soonest first (the same day: most recent year
 * first, yearless last), and how many more the window holds. Without
 * Only living that's one query, plus one to fetch the events' profiles;
 * with it, a batch at a time until `limit` pass. Never throws: Home shows
 * an empty card instead. */
export async function fetchAnniversaryWindow(
  token: string, limit: number, index: number, today = new Date(), options: AnniversaryOptions = {},
): Promise<AnniversaryWindow> {
  const { start, end } = windowRange(index, today);
  const onlyLiving = !!options.onlyLiving;
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE_PROB_ALIVE;
  const expr = windowExpr(start, end, onlyLiving ? { fromYear: today.getFullYear() - maxAge } : null);
  try {
    const items: AnniversaryItem[] = [];
    let after: string | null = null;
    let more: number | null = 0;
    for (;;) {
      const { page, totalCount } = await fetchPage(
        EVENT_VIEW, token, after, !onlyLiving, expr, ORDER, onlyLiving ? LIVING_BATCH : limit, []
      );
      const handles = page.items.map((item) => item.handle);
      const events = await fetchObjectsByHandle(token, "event", handles);
      let used = 0;
      for (const handle of handles) {
        if (items.length >= limit) break;
        used++;
        const event = events.get(handle);
        if (event && (!onlyLiving || isAboutTheLiving(event, maxAge, today.getFullYear()))) items.push(toItem(event, start, end, today));
      }
      if (!onlyLiving) {
        more = totalCount === null ? null : Math.max(0, totalCount - items.length);
        break;
      }
      if (items.length >= limit) {
        // Full: anything unchecked might still pass.
        more = used < handles.length || page.next_after ? null : 0;
        break;
      }
      if (!page.next_after) break;
      after = page.next_after;
    }
    items.sort((a, b) => a.daysUntil - b.daysUntil || (a.years ?? Infinity) - (b.years ?? Infinity));
    return { start, end, items, more };
  } catch (err) {
    console.warn("[home] anniversaries: fetch failed", err);
    return { start, end, items: [], more: 0 };
  }
}

const ONLY_LIVING_KEY = STORAGE_KEYS.anniversariesOnlyLiving;

/** The card's Only living box, remembered per browser. */
export function getOnlyLivingPreference(): boolean {
  try {
    return localStorage.getItem(ONLY_LIVING_KEY) === "1";
  } catch {
    return false;
  }
}

export function setOnlyLivingPreference(on: boolean): void {
  try {
    localStorage.setItem(ONLY_LIVING_KEY, on ? "1" : "0");
  } catch {
    // private window / blocked storage: just not remembered
  }
}

function intlLocale(): string {
  return getI18nSnapshot().lang.replace(/_/g, "-");
}

/** "today" / "tomorrow" / "in 5 days" / "yesterday" / "5 days ago", in the
 * UI language. */
export function formatDaysUntil(days: number): string {
  try {
    return new Intl.RelativeTimeFormat(intlLocale(), { numeric: "auto" }).format(days, "day");
  } catch {
    return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(days, "day");
  }
}

/** "150 years", in the UI language. */
export function formatYears(years: number): string {
  try {
    return new Intl.NumberFormat(intlLocale(), { style: "unit", unit: "year", unitDisplay: "long" }).format(years);
  } catch {
    return `${years} years`;
  }
}

/** "4 Nov – 3 Dec", in the UI language. (formatRange isn't in this
 * project's TS lib, though every supported browser has it.) */
export function formatWindow(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat(intlLocale(), opts);
  } catch {
    fmt = new Intl.DateTimeFormat("en", opts);
  }
  const ranged = fmt as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string };
  return ranged.formatRange ? ranged.formatRange(start, end) : `${fmt.format(start)} – ${fmt.format(end)}`;
}
