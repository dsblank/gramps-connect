// Home's "Anniversaries" card: the next few births, marriages and deaths
// whose day and month fall on or after today, wrapping into January, and
// (paging back with the card's arrows) the ones just missed.
//
// gramps-web's own dashboard card (GrampsjsViewAnniversaries.js) only shows
// *today*, via /api/events/?dates=*/m/d. Looking ahead needs a month/day
// range instead, which that endpoint can't express, so this is a GOQL query
// on the event table, ordered by the date's month then day. Like the ICS feed
// (gramps-web-api's /api/anniversaries.ics), only exact dates count: no
// about/before/after/range, no estimated or calculated quality, and a known
// day and month. Unlike it, only the Gregorian calendar (converting a Julian
// or Hebrew date's day and month would need doing in SQL to sort on).
import { fetchPage } from "./api";
import { EVENT_VIEW, type OrderBy } from "./views";
import { fetchObjectsByHandle, type RawRecord } from "./objectsByHandle";
import { getI18nSnapshot } from "../i18n/i18n";

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
  /** 0 = today, 1 = tomorrow, ...; -1 = yesterday, ... for one already
   * passed (a page paged back to). */
  daysUntil: number;
  /** How many years this occurrence marks (the next one, or for a passed
   * one the most recent), or null when the year isn't recorded. */
  years: number | null;
}

const BASE_EXPR =
  "type.value in [EventType.BIRTH, EventType.DEATH, EventType.MARRIAGE]" +
  " and date.modifier == Date.MOD_NONE and date.quality == Date.QUAL_NONE" +
  " and date.calendar == Date.CAL_GREGORIAN" +
  " and date.dateval[0] > 0 and date.dateval[1] > 0";

/** Soonest first; on the same day, the most recent year first, as
 * gramps-web's card does. */
const FORWARD_ORDER: OrderBy[] = [
  { column: "date.dateval[1]", direction: "asc" },
  { column: "date.dateval[0]", direction: "asc" },
  { column: "date.dateval[2]", direction: "desc" },
];

/** The exact reverse, for paging back from yesterday: reversing a fetched
 * page then reads in the same order as a forward one. */
const BACKWARD_ORDER: OrderBy[] = FORWARD_ORDER.map((o) => ({
  ...o, direction: o.direction === "asc" ? "desc" : "asc",
}));

/** The where_expr for events from (month, day) through 31 December
 * (`onOrAfter`), or from 1 January up to the day before. Dated after this
 * year is left out: nothing has happened yet to have an anniversary of. A
 * yearless date (year 0) passes. */
export function anniversaryExpr(month: number, day: number, year: number, onOrAfter: boolean): string {
  const range = onOrAfter
    ? `(date.dateval[1] > ${month} or (date.dateval[1] == ${month} and date.dateval[0] >= ${day}))`
    : `(date.dateval[1] < ${month} or (date.dateval[1] == ${month} and date.dateval[0] < ${day}))`;
  return `${BASE_EXPR} and date.dateval[2] <= ${year} and ${range}`;
}

/** Days from `today` back to the most recent (month, day) before it (a
 * negative number), and that occurrence's year. */
export function previousOccurrence(month: number, day: number, today: Date): { daysUntil: number; year: number } {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let prev = new Date(start.getFullYear(), month - 1, day);
  if (prev >= start) prev = new Date(start.getFullYear() - 1, month - 1, day);
  const daysUntil = Math.round((prev.getTime() - start.getTime()) / 86_400_000);
  return { daysUntil, year: prev.getFullYear() };
}

/** Days from `today` to the next (month, day), and that occurrence's year.
 * 29 February in a year without one falls on 1 March, as JS Date rolls it. */
export function nextOccurrence(month: number, day: number, today: Date): { daysUntil: number; year: number } {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let next = new Date(start.getFullYear(), month - 1, day);
  if (next < start) next = new Date(start.getFullYear() + 1, month - 1, day);
  // Math.round: a daylight-saving change makes one day 23 or 25 hours.
  const daysUntil = Math.round((next.getTime() - start.getTime()) / 86_400_000);
  return { daysUntil, year: next.getFullYear() };
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

function toItem(event: RawRecord, today: Date, backward: boolean): AnniversaryItem {
  const profile = event.profile as Profile | undefined;
  const [day, month, year] = ((event.date as Profile | undefined)?.dateval ?? []) as number[];
  const next = backward ? previousOccurrence(month, day, today) : nextOccurrence(month, day, today);
  const who = participant(profile);
  return {
    eventHandle: event.handle,
    viewKey: who?.viewKey ?? "event",
    handle: who?.handle ?? event.handle,
    typeLabel: String(profile?.type ?? ""),
    who: who?.who ?? "",
    dateLabel: String(profile?.date ?? ""),
    daysUntil: next.daysUntil,
    years: year > 0 && next.year - year > 0 ? next.year - year : null,
  };
}

/** Where the next page in one direction starts: which of the two
 * year-segments (see anniversaryPage()), and the server's keyset cursor
 * within it. */
export interface AnniversaryCursor {
  segment: 0 | 1;
  after: string | null;
}

export interface AnniversaryPage {
  /** Always in calendar order, earliest first, whichever the direction. */
  items: AnniversaryItem[];
  /** Where the page after this one (further from today) starts, or null
   * once the whole year has been covered in this direction. */
  next: AnniversaryCursor | null;
}

/** One page of `limit` anniversaries, walking away from today: forward
 * (`backward` false) from today through 31 December then 1 January up to
 * yesterday, or backward from yesterday through 1 January then 31 December
 * down to today. Either way one full year at most, so the two directions
 * meet but never repeat a day. `cursor` is the previous page's `next`
 * (null for the first page). A page straddling 31 December/1 January takes
 * a second query. Never throws: Home shows an empty card instead. */
export async function fetchAnniversaryPage(
  token: string, limit: number, backward = false, cursor: AnniversaryCursor | null = null, today = new Date(),
): Promise<AnniversaryPage> {
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const year = today.getFullYear();
  // Forward: [today..31 Dec, 1 Jan..yesterday]. Backward: [yesterday..1 Jan,
  // 31 Dec..today], whose second segment's occurrences were last year, so
  // anything dated this year there hasn't happened yet.
  const segments = backward
    ? [anniversaryExpr(month, day, year, false), anniversaryExpr(month, day, year - 1, true)]
    : [anniversaryExpr(month, day, year, true), anniversaryExpr(month, day, year, false)];
  const order = backward ? BACKWARD_ORDER : FORWARD_ORDER;
  try {
    const handles: string[] = [];
    let at: AnniversaryCursor | null = cursor ?? { segment: 0, after: null };
    while (at && handles.length < limit) {
      const want = limit - handles.length;
      const { page } = await fetchPage(EVENT_VIEW, token, at.after, false, segments[at.segment], order, want, []);
      handles.push(...page.items.map((item) => item.handle));
      if (page.items.length >= want && page.next_after) at = { segment: at.segment, after: page.next_after };
      else at = at.segment === 0 ? { segment: 1, after: null } : null;
    }
    const events = await fetchObjectsByHandle(token, "event", handles);
    const items = handles.flatMap((handle) => {
      const event = events.get(handle);
      return event ? [toItem(event, today, backward)] : [];
    });
    if (backward) items.reverse();
    return { items, next: at };
  } catch (err) {
    console.warn("[home] anniversaries: fetch failed", err);
    return { items: [], next: null };
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
