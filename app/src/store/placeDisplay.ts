// Port of Gramps' automatic place titles: gen/display/place.py's
// PlaceDisplay.display() plus the gen/utils/location.py helpers it calls
// (get_location_list, __get_name, __get_latest_date). Pure -- callers hand
// in a lookup over whatever place data they have (placeIndex.ts builds one
// from the local place cache) -- so the slicing rules can be tested against
// desktop's behavior without a database.
//
// Differences from the original, all deliberate:
//   - A cycle in the hierarchy stops the walk (desktop's get_location_list
//     does this too, via `visited`), and a missing parent ends it quietly.
import { Modifier, getStopDate, dateToSdn, type GrampsDate } from "@gramps-connect/gramps-date";
import type { PlaceFormatDef } from "./displaySettings";

export interface PlaceNameJson {
  value: string;
  lang?: string;
  date?: GrampsDate | null;
}

export interface PlaceRecord {
  name: PlaceNameJson | null;
  altNames: PlaceNameJson[];
  /** PlaceType's integer (`place_type.value` in the raw JSON; 0 = custom). */
  type: number;
  /** Raw placeref_list: enclosing places, each optionally dated. */
  parents: { ref: string; date?: GrampsDate | null }[];
}

export type PlaceLookup = (handle: string) => PlaceRecord | null | undefined;

// gen/lib/placetype.py: _find_populated_place's [HAMLET, VILLAGE, TOWN,
// CITY], and NUMBER for the street merge.
const POPULATED_TYPES = new Set([17, 16, 15, 4]);
const NUMBER_TYPE = 20;

// -- Date.match_exact, on sortvals (gen/lib/date.py) --

function isEmptyDate(date: GrampsDate | null | undefined): boolean {
  if (!date) return true;
  if (date.modifier === Modifier.TEXTONLY) return !date.text;
  return date.dateval.slice(0, 3).every((v) => v === 0) && (date.dateval.length <= 4 || date.dateval.slice(4, 7).every((v) => v === 0));
}

/** Date._calc_sort_value for a bare date part: 0 for an empty one, else the
 * day number with month/day 0 treated as 1 (_zero_adjust_ymd). */
function partSortval(date: GrampsDate, part: readonly unknown[]): number {
  const [day, month, year] = part as number[];
  if (day === 0 && month === 0 && year === 0) return 0;
  return dateToSdn(date.calendar, year, Math.max(month, 1), Math.max(day, 1));
}

function sortvalOf(date: GrampsDate): number {
  return date.sortval ?? partSortval(date, date.dateval);
}

/** `self.match_exact(other)` with self reduced to its sortval. */
function matchExact(selfSortval: number, other: GrampsDate): boolean {
  switch (other.modifier) {
    case Modifier.NONE:
      return sortvalOf(other) === selfSortval;
    case Modifier.BEFORE:
    case Modifier.TO:
      return sortvalOf(other) > selfSortval;
    case Modifier.AFTER:
    case Modifier.FROM:
      return sortvalOf(other) < selfSortval;
    case Modifier.RANGE:
    case Modifier.SPAN:
      return sortvalOf(other) <= selfSortval && selfSortval <= partSortval(other, getStopDate(other));
    default:
      return false;
  }
}

function todaySortval(): number {
  const now = new Date();
  return dateToSdn(0, now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** __get_latest_date: "today" if any name is open-ended, else the latest
 * point any dated name covers. Used when formatting a place on its own,
 * with no event date to pick its names by. */
function latestDateSortval(place: PlaceRecord): number {
  let latest: number | null = null;
  for (const name of allNames(place)) {
    const date = name.date;
    if (isEmptyDate(date) || date!.modifier === Modifier.FROM || date!.modifier === Modifier.AFTER) return todaySortval();
    let value =
      date!.modifier === Modifier.RANGE || date!.modifier === Modifier.SPAN ? partSortval(date!, getStopDate(date!)) : sortvalOf(date!);
    if (date!.modifier === Modifier.TO || date!.modifier === Modifier.BEFORE) value -= 1;
    if (latest === null || value > latest) latest = value;
  }
  return latest ?? todaySortval();
}

function allNames(place: PlaceRecord): PlaceNameJson[] {
  return place.name ? [place.name, ...place.altNames] : place.altNames;
}

/** __get_name: the first name valid at `date` in `lang`, else the first
 * valid name in any language, else "?". */
function nameAt(place: PlaceRecord, dateSortval: number, lang: string): string {
  let endonym: string | null = null;
  for (const name of allNames(place)) {
    if (isEmptyDate(name.date) || matchExact(dateSortval, name.date!)) {
      if ((name.lang ?? "") === lang) return name.value;
      if (endonym === null) endonym = name.value;
    }
  }
  return endonym ?? "?";
}

/** get_location_list: [name, type] from the place itself up through the
 * first enclosing place valid at `date`, level by level. */
export function locationList(lookup: PlaceLookup, handle: string, date: GrampsDate | null, lang: string): [string, number][] | null {
  let place = lookup(handle);
  if (!place) return null;
  const dateSortval = date ? sortvalOf(date) : latestDateSortval(place);
  const visited = new Set([handle]);
  const lines: [string, number][] = [[nameAt(place, dateSortval, lang), place.type]];
  for (;;) {
    const ref = place.parents.find((p) => isEmptyDate(p.date) || matchExact(dateSortval, p.date!))?.ref;
    if (!ref || visited.has(ref)) break;
    const parent = lookup(ref);
    if (!parent) break;
    visited.add(ref);
    place = parent;
    lines.push([nameAt(place, dateSortval, lang), place.type]);
  }
  return lines;
}

function findPopulatedPlace(places: [string, number][]): number | null {
  let found: number | null = null;
  places.forEach(([, type], index) => {
    if (POPULATED_TYPES.has(type)) found = index;
  });
  return found;
}

/** _get_offset: "pN" is relative to the populated place (when there is
 * one), anything else a plain index; unparseable -> null (= open end). */
function offsetOf(value: string, populated: number | null): number | null {
  if (populated !== null && value.startsWith("p")) {
    const n = parseInt(value.slice(1), 10);
    return (Number.isNaN(n) ? 0 : n) + populated;
  }
  const n = Number(value);
  return value.trim() === "" || !Number.isInteger(n) ? null : n;
}

/** Python list slicing, including negative and out-of-range bounds. */
function pySlice<T>(list: T[], start: number | null, end: number | null): T[] {
  const norm = (i: number) => (i < 0 ? Math.max(list.length + i, 0) : Math.min(i, list.length));
  return list.slice(start === null ? 0 : norm(start), end === null ? list.length : norm(end));
}

/** PlaceDisplay.display() with place-auto on: null when the place itself
 * isn't in `lookup` (caller falls back to the stored title). `date` is the
 * event's date when formatting an event's place (display_event), or
 * null/undefined for a place on its own. */
export function formatPlace(lookup: PlaceLookup, handle: string, fmt: PlaceFormatDef, date?: GrampsDate | null): string | null {
  const all = locationList(lookup, handle, date ?? null, fmt.language);
  if (!all) return null;

  const index = findPopulatedPlace(all);
  let places: [string, number][] = [];
  for (const slice of fmt.levels.split(",")) {
    const parts = slice.split(":");
    if (parts.length === 1) {
      const offset = offsetOf(parts[0], index);
      if (offset !== null) {
        // Python's all_places[offset], IndexError swallowed.
        const item = offset < 0 ? all[all.length + offset] : all[offset];
        if (item) places.push(item);
      }
    } else if (parts.length === 2) {
      places.push(...pySlice(all, offsetOf(parts[0], index), offsetOf(parts[1], index)));
    }
  }

  if (fmt.street) {
    const idx = places.findIndex(([, type]) => type === NUMBER_TYPE);
    if (idx !== -1 && places.length > idx + 1) {
      const [number] = places[idx];
      const [street, streetType] = places[idx + 1];
      const combined: [string, number] = [fmt.street === 1 ? `${number} ${street}` : `${street} ${number}`, streetType];
      places = [...places.slice(0, idx), combined, ...places.slice(idx + 2)];
    }
  }

  const names = places.map(([name]) => name);
  if (fmt.reverse) names.reverse();
  return names.join(", ");
}
