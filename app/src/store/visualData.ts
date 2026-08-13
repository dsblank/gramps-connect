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
import { formatEventType, parseHandleList } from "./views";

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

/** A cached Event, whether or not its date can be placed on an axis. */
export interface EventRecord {
  handle: string;
  grampsId: string;
  /** Event type as display text (see views.ts's formatEventType) -- what
   * the dots are grouped and colored by. */
  type: string;
  description: string;
  placeTitle: string;
  /** Formatted date, for the tooltip. Empty when there's no date at all. */
  dateText: string;
  /** Fractional Gregorian year, or null when the date can't be placed on
   * an axis (unset, or text-only). Fractional so dots within a year still
   * separate when zoomed right in, without dragging JS Date (and its
   * year-1..99 and BC handling) into it. */
  year: number | null;
}

/** An EventRecord datable enough to plot -- the timeline's x axis needs a
 * year, so it takes only these. Narrowed rather than a separate shape: the
 * two collections below share their objects by reference, so an undated
 * event costs nothing extra and a dated one isn't stored twice. */
export interface TimelineEvent extends EventRecord {
  year: number;
}

export interface VisualData {
  places: MapPlace[];
  events: TimelineEvent[];
  /** Event handle -> the place it happened at, for turning a set of scoped
   * events into the places to plot them at (store/visualScope.ts). Covers
   * *undated* events too, unlike `events` above: a person's undated burial
   * still has a location worth putting on their map. */
  placeOfEvent: Map<string, string>;
  /** The inverse: place handle -> handles of the events there. What lets
   * "everything that happened in this town" be answered locally. */
  eventsByPlace: Map<string, string[]>;
  /** Every cached event by handle, dated or not -- what lets a scoped view
   * say *which* events put a place in scope, rather than only how many.
   * `events` above holds the datable subset of these same objects. */
  eventsByHandle: Map<string, EventRecord>;
  /** Place handle -> handles of the places directly inside it, inverted
   * from each place's own `enclosed_by`. Gramps records an event against
   * the most specific place it knows, so scoping to a county or a country
   * has to walk down this to reach the towns that actually carry events.
   * Includes places with no coordinates of their own, which is the common
   * shape for exactly those upper levels. */
  childPlaces: Map<string, string[]>;
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
  placeOfEvent: new Map(), eventsByPlace: new Map(), eventsByHandle: new Map(), childPlaces: new Map(),
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
  // The two scoping indexes (see VisualData), filled from the same scan.
  const placeOfEvent = new Map<string, string>();
  const eventsByPlace = new Map<string, string[]>();
  const eventsByHandle = new Map<string, EventRecord>();

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
      placeOfEvent.set(handle, placeHandle);
      const atPlace = eventsByPlace.get(placeHandle);
      if (atPlace) atPlace.push(handle);
      else eventsByPlace.set(placeHandle, [handle]);
      if (year !== null) {
        const years = yearsByPlace.get(placeHandle);
        if (years) years.push(year);
        else yearsByPlace.set(placeHandle, [year]);
      }
    }
    // Built for every event, then shared by reference into `events` when
    // it's datable -- an undated event still has to be nameable (a scoped
    // place card lists it as what put that place in scope), it just can't
    // be plotted.
    const record: EventRecord = {
      handle,
      grampsId: grampsId ?? "",
      type: formatEventType(typeJson) || "Unknown",
      description: description ?? "",
      placeTitle: placeTitle ?? "",
      dateText: formatStoredDate(dateJson),
      year,
    };
    eventsByHandle.set(handle, record);
    if (year !== null) events.push(record as TimelineEvent);
  }
  events.sort((a, b) => a.year - b.year);
  for (const years of yearsByPlace.values()) years.sort((a, b) => a - b);

  const places: MapPlace[] = [];
  const childPlaces = new Map<string, string[]>();
  for (const row of placeStore.readColumns(["handle", "gramps_id", "title", "lat", "long", "enclosed_by"])) {
    const [handle, grampsId, title, latText, longText, enclosedBy] = row as [
      string, string | null, string | null, string | null, string | null, string | null,
    ];
    // Before the coordinate check below, not after: a country or county
    // usually has no coordinates of its own but is exactly the level a
    // user scopes to, and dropping it here would sever the towns beneath
    // it from the walk in visualScope.ts.
    for (const parent of parseHandleList(enclosedBy)) {
      const children = childPlaces.get(parent);
      if (children) children.push(handle);
      else childPlaces.set(parent, [handle]);
    }
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
    placeOfEvent,
    eventsByPlace,
    eventsByHandle,
    childPlaces,
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
