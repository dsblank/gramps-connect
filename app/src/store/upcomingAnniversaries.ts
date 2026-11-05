// Home's "Anniversaries" card: the births, marriages and deaths whose day
// and month fall in a 30-day window -- from today at first, then (with the
// card's arrows) the 30 days before or after that, and so on -- with the
// most recent events first, so a sister's 14th wedding anniversary comes
// ahead of a death from 1890.
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

/** Days in one window of the card. */
export const WINDOW_DAYS = 30;

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
  /** How many events the window holds in all (null if the server didn't
   * say), so the card can say how many more there are. */
  total: number | null;
}

const BASE_EXPR =
  "type.value in [EventType.BIRTH, EventType.DEATH, EventType.MARRIAGE]" +
  " and date.modifier == Date.MOD_NONE and date.quality == Date.QUAL_NONE" +
  " and date.calendar == Date.CAL_GREGORIAN" +
  " and date.dateval[0] > 0 and date.dateval[1] > 0";

/** Most recent year first; a yearless date (year 0) last. Then by day. */
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

/** Window `index` around `today`: 0 is today and the 29 days after, 1 the
 * 30 after those, -1 the 30 days up to yesterday, ... */
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
 * (year 0) passes. */
export function windowExpr(start: Date, end: Date): string {
  const piece = (year: number, from: string, to: string) => `(date.dateval[2] <= ${year} and ${from} and ${to})`;
  const sm = start.getMonth() + 1, sd = start.getDate();
  const em = end.getMonth() + 1, ed = end.getDate();
  const pieces = start.getFullYear() === end.getFullYear()
    ? [piece(start.getFullYear(), onOrAfter(sm, sd), onOrBefore(em, ed))]
    : [piece(start.getFullYear(), onOrAfter(sm, sd), onOrBefore(12, 31)),
      piece(end.getFullYear(), onOrAfter(1, 1), onOrBefore(em, ed))];
  return `${BASE_EXPR} and (${pieces.join(" or ")})`;
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

/** The most recent `limit` anniversaries in window `index` (see
 * windowRange()), and how many it holds in all: one query, plus one to
 * fetch the events' profiles. Never throws: Home shows an empty card
 * instead. */
export async function fetchAnniversaryWindow(
  token: string, limit: number, index: number, today = new Date(),
): Promise<AnniversaryWindow> {
  const { start, end } = windowRange(index, today);
  try {
    const { page, totalCount } = await fetchPage(
      EVENT_VIEW, token, null, true, windowExpr(start, end), ORDER, limit, []
    );
    const handles = page.items.map((item) => item.handle);
    const events = await fetchObjectsByHandle(token, "event", handles);
    const items = handles.flatMap((handle) => {
      const event = events.get(handle);
      return event ? [toItem(event, start, end, today)] : [];
    });
    return { start, end, items, total: totalCount };
  } catch (err) {
    console.warn("[home] anniversaries: fetch failed", err);
    return { start, end, items: [], total: null };
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
