// Home's "Upcoming anniversaries" card: the next few births, marriages and
// deaths whose day and month fall on or after today, wrapping into January.
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
  /** 0 = today, 1 = tomorrow, ... */
  daysUntil: number;
  /** How many years this occurrence marks, or null when the year isn't
   * recorded. */
  years: number | null;
}

const BASE_EXPR =
  "type.value in [EventType.BIRTH, EventType.DEATH, EventType.MARRIAGE]" +
  " and date.modifier == Date.MOD_NONE and date.quality == Date.QUAL_NONE" +
  " and date.calendar == Date.CAL_GREGORIAN" +
  " and date.dateval[0] > 0 and date.dateval[1] > 0";

/** Same day: the most recent year first, as gramps-web's card does. */
const ORDER: OrderBy[] = [
  { column: "date.dateval[1]", direction: "asc" },
  { column: "date.dateval[0]", direction: "asc" },
  { column: "date.dateval[2]", direction: "desc" },
];

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

function toItem(event: RawRecord, today: Date): AnniversaryItem {
  const profile = event.profile as Profile | undefined;
  const [day, month, year] = ((event.date as Profile | undefined)?.dateval ?? []) as number[];
  const next = nextOccurrence(month, day, today);
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

/** The next `limit` anniversaries from today, soonest first. Two queries at
 * most: today through 31 December, then (only if that came up short) 1
 * January up to yesterday. Never throws: Home shows an empty card instead. */
export async function fetchUpcomingAnniversaries(token: string, limit: number, today = new Date()): Promise<AnniversaryItem[]> {
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const year = today.getFullYear();
  try {
    const handles: string[] = [];
    for (const onOrAfter of [true, false]) {
      const { page } = await fetchPage(
        EVENT_VIEW, token, null, false, anniversaryExpr(month, day, year, onOrAfter), ORDER, limit - handles.length, []
      );
      handles.push(...page.items.map((item) => item.handle));
      if (handles.length >= limit) break;
    }
    const events = await fetchObjectsByHandle(token, "event", handles);
    return handles.flatMap((handle) => {
      const event = events.get(handle);
      return event ? [toItem(event, today)] : [];
    });
  } catch (err) {
    console.warn("[home] upcoming anniversaries: fetch failed", err);
    return [];
  }
}

function intlLocale(): string {
  return getI18nSnapshot().lang.replace(/_/g, "-");
}

/** "today" / "tomorrow" / "in 5 days", in the UI language. */
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
