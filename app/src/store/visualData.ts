// Feeds the Map and Timeline from the local SQLite caches the Places and
// Events views already keep, instead of fetching the tree over again.
//
// This is the one real architectural difference from gramps-web, whose
// GrampsjsViewMap/GrampsjsViewTimeline each open by GETting /api/places/
// and /api/events/ in full and hold the result in component state. Here
// both datasets are already on the client, already deduplicated between
// the table and the visuals, already persisted to OPFS across reloads, and
// already being patched in place by live sync -- so opening either visual
// is a synchronous read of a few thousand rows out of sql.js rather than a
// multi-second round trip, it works with no network at all, and someone
// else's edit lands on the map without a refetch. What that costs is
// completeness: a view whose background fill hasn't finished yet has only a
// prefix of the tree cached, which is why loadVisualData() waits on
// ensureLoaded() and callers watch loadedCount/totalCount to say so.
import {
  DateFormat, formatDate, getStartDate, gregorianSdn, gregorianYmd, type GrampsDate,
} from "@gramps-connect/gramps-date";
import { getViewStore } from "./registry";
import { formatEventType } from "./views";

/** A cached Place that has usable coordinates. */
export interface MapPlace {
  handle: string;
  grampsId: string;
  title: string;
  lat: number;
  long: number;
  /** How many cached events happened here -- what sizes the marker. */
  eventCount: number;
  /** Gregorian years of those events, ascending, for the time filter.
   * Events with no usable date contribute nothing. */
  years: number[];
}

/** A cached Event that has a usable date. */
export interface TimelineEvent {
  handle: string;
  grampsId: string;
  /** Event type as display text (see views.ts's formatEventType) -- what
   * the dots are grouped and colored by. */
  type: string;
  description: string;
  placeTitle: string;
  /** Formatted date, for the tooltip. */
  dateText: string;
  /** Fractional Gregorian year -- the timeline's x axis. Fractional so
   * dots within a year still separate when zoomed right in, without
   * dragging JS Date (and its year-1..99 and BC handling) into it. */
  year: number;
}

export interface VisualData {
  places: MapPlace[];
  events: TimelineEvent[];
  /** Rows cached vs. rows the server says exist, per object type -- the
   * visuals plot the first number and disclose the second, since a
   * still-filling cache means an honestly incomplete picture. */
  placesCached: number;
  placesTotal: number;
  eventsCached: number;
  eventsTotal: number;
}

export const EMPTY_VISUAL_DATA: VisualData = {
  places: [], events: [],
  placesCached: 0, placesTotal: 0, eventsCached: 0, eventsTotal: 0,
};

/** Gregorian year of a stored date, fractional within the year, or null
 * when the date can't be placed on an axis at all. Exported for its own
 * tests -- it's the one piece of real arithmetic in this module.
 *
 * Text-only dates (Modifier.TEXTONLY, which getStartDate already flattens
 * to 0/0/0) and empty dates both land on year 0 and are dropped -- Gramps
 * has no year 0, so it can only mean "unset". A range/span contributes its
 * start, matching how the Events table's own Date column reads. */
export function dateToYear(date: GrampsDate): number | null {
  const [day, month, year] = getStartDate(date);
  if (!year) return null;
  const sdn = date.sortval;
  // A year-only or year-month date gets no false precision: it sits at the
  // start of whatever it does specify. Same fallback if there's no sortval
  // to work from (it's optional on the wire).
  if (!sdn || !month || !day) return year + (month ? (month - 1) / 12 : 0);
  // A full date is placed via its SDN instead, which normalizes the stored
  // calendar (Julian, Hebrew, French Republican, ...) away -- so a Julian
  // date lands on the axis at the Gregorian instant it actually names,
  // rather than 11-odd days off it. gregorianYmd/gregorianSdn are exact
  // inverses, so bracketing the SDN by its own year's Jan 1 and the next
  // gives the fraction through the year with leap years handled for free.
  const [gregorianYear] = gregorianYmd(sdn);
  const yearStart = gregorianSdn(gregorianYear, 1, 1);
  const nextYearStart = gregorianSdn(gregorianYear + 1, 1, 1);
  return gregorianYear + (sdn - yearStart) / (nextYearStart - yearStart);
}

/** Same formatting the Events table's own Date column uses, so a dot's
 * tooltip and its table row agree. */
function formatStoredDate(dateJson: string | null): string {
  if (!dateJson) return "";
  return formatDate(JSON.parse(dateJson) as GrampsDate, { format: DateFormat.DAY_SHORT_MONTH_YEAR });
}

/** Loads (if needed) and reads both caches. Awaits ensureLoaded() on each
 * view, so the first open of either visual pays whatever the Places/Events
 * views themselves would have paid -- and nothing at all if the user has
 * already visited them this session. */
export async function loadVisualData(): Promise<VisualData> {
  const placeStore = getViewStore("place");
  const eventStore = getViewStore("event");
  await Promise.all([placeStore.ensureLoaded(), eventStore.ensureLoaded()]);
  return readVisualData();
}

/** Synchronous re-read of whatever is cached right now -- what a live-sync
 * revision bump or a completed background fill re-runs, with no fetching of
 * its own. */
export function readVisualData(): VisualData {
  const placeStore = getViewStore("place");
  const eventStore = getViewStore("event");
  const placeSnapshot = placeStore.getSnapshot();
  const eventSnapshot = eventStore.getSnapshot();

  const events: TimelineEvent[] = [];
  // Place handle -> years of events there, built in the same pass as the
  // timeline's own rows: one scan of the events table serves both visuals.
  const yearsByPlace = new Map<string, number[]>();
  const countByPlace = new Map<string, number>();

  for (const row of eventStore.readColumns([
    "handle", "gramps_id", "event_type", "description", "place_title", "place", "date",
  ])) {
    const [handle, grampsId, typeJson, description, placeTitle, placeHandle, dateJson] = row as [
      string, string | null, string | null, string | null, string | null, string | null, string | null,
    ];
    const date = dateJson ? (JSON.parse(dateJson) as GrampsDate) : null;
    const year = date ? dateToYear(date) : null;
    if (placeHandle) {
      countByPlace.set(placeHandle, (countByPlace.get(placeHandle) ?? 0) + 1);
      if (year !== null) {
        const years = yearsByPlace.get(placeHandle);
        if (years) years.push(year);
        else yearsByPlace.set(placeHandle, [year]);
      }
    }
    if (year === null) continue;
    events.push({
      handle,
      grampsId: grampsId ?? "",
      type: formatEventType(typeJson) || "Unknown",
      description: description ?? "",
      placeTitle: placeTitle ?? "",
      dateText: formatStoredDate(dateJson),
      year,
    });
  }
  events.sort((a, b) => a.year - b.year);
  for (const years of yearsByPlace.values()) years.sort((a, b) => a - b);

  const places: MapPlace[] = [];
  for (const row of placeStore.readColumns(["handle", "gramps_id", "title", "lat", "long"])) {
    const [handle, grampsId, title, latText, longText] = row as [
      string, string | null, string | null, string | null, string | null,
    ];
    const coords = parseCoords(latText, longText);
    if (!coords) continue;
    places.push({
      handle,
      grampsId: grampsId ?? "",
      title: title ?? "",
      lat: coords[0],
      long: coords[1],
      eventCount: countByPlace.get(handle) ?? 0,
      years: yearsByPlace.get(handle) ?? [],
    });
  }

  return {
    places,
    events,
    placesCached: placeSnapshot.loadedCount,
    placesTotal: placeSnapshot.totalCount,
    eventsCached: eventSnapshot.loadedCount,
    eventsTotal: eventSnapshot.totalCount,
  };
}

/** Place.lat/long are free-text columns in Gramps, so an unset one is ""
 * rather than null, and 0/0 is the conventional "not really located"
 * value gramps-web also discards (see its _hasCoords). Out-of-range
 * values are dropped too: maplibre would otherwise wrap or clamp them
 * into a marker at a plausible-looking but wrong spot. */
function parseCoords(latText: string | null, longText: string | null): [number, number] | null {
  if (!latText || !longText) return null;
  const lat = Number.parseFloat(latText);
  const long = Number.parseFloat(longText);
  if (Number.isNaN(lat) || Number.isNaN(long)) return null;
  if (lat === 0 && long === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(long) > 180) return null;
  return [lat, long];
}
