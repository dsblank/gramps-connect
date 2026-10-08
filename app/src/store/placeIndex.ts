// Display-time place titles and dates, per the tree's display settings
// (displaySettings.ts). The place formatter itself (placeDisplay.ts) is
// pure; this module feeds it from the local Places cache -- whose hidden
// place_type/alt_names/placerefs columns exist for exactly this (views.ts)
// -- and answers "what should this place/date look like right now" for
// every display site: DataTable cells, Timeline, Story, summaries, search
// snippets.
//
// Everything here is synchronous and best-effort: a place that isn't in the
// cache (not loaded yet, or not reached by a background fill) formats to
// null, and the caller shows the stored title instead -- then re-renders
// with the formatted one once the cache catches up, via
// useDisplayFormatVersion().
import { useEffect, useSyncExternalStore } from "react";
import { formatDate, isLocaleRegistered, loadLocale, parseDate, resolveLocaleCode, type GrampsDate } from "@gramps-connect/gramps-date";
import { getI18nSnapshot, subscribe as subscribeI18n } from "../i18n/i18n";
import type { ViewStore } from "./viewStore";
import { formatPlace, locationList, type PlaceRecord } from "./placeDisplay";
import { getDisplaySettings, grampsFormatFor, loadDisplaySettings, subscribeDisplaySettings, type PlaceFormatDef } from "./displaySettings";

// The Places ViewStore, handed in by registry.ts as it creates the stores
// (attachPlaceStore) rather than imported from there: views.ts imports this
// module for its toDisplay functions, and registry.ts imports views.ts, so
// importing registry here would be a load-time cycle.
let placeStore: ViewStore | null = null;
// Events, too: lifeEventDates.ts reads chart/snippet dates from there, so
// its first load is also a reason to re-render.
let eventStore: ViewStore | null = null;
const pendingAttach: (() => void)[] = [];

export function attachDisplayStores(stores: { place: ViewStore; event: ViewStore }): void {
  placeStore = stores.place;
  eventStore = stores.event;
  for (const fn of pendingAttach.splice(0)) fn();
}

let index: { revision: number; loadedCount: number; places: Map<string, PlaceRecord> } | null = null;
// handle + date sortval -> formatted title; dropped whenever the index or
// the settings change, so it never outlives what it was computed from.
let titleCache = new Map<string, string | null>();
let titleCacheSettings = getDisplaySettings();
let placeLoadRequested = false;

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** The place lookup, or null when there's no complete one yet. Only built
 * from a *complete, unfiltered* Places cache: a filtered query (a search in
 * the Places table) replaces the cached rows with just the matches, and a
 * background fill has only a prefix -- either way enclosing places would be
 * missing and titles cut short. In those states the last complete index
 * keeps serving (its places are a superset of a filtered set's). */
function getIndex(store: ViewStore): Map<string, PlaceRecord> | null {
  const snapshot = store.getSnapshot();
  if (index && index.revision === snapshot.revision && index.loadedCount === snapshot.loadedCount) return index.places;
  const complete =
    snapshot.loadedCount > 0 && snapshot.loadedCount >= snapshot.totalCount &&
    snapshot.whereExpr === null && snapshot.pickerExpr === null;
  if (!complete) return index?.places ?? null;
  const places = new Map<string, PlaceRecord>();
  for (const row of store.readColumns(["handle", "name", "alt_names", "place_type", "placerefs"])) {
    const [handle, name, altNames, placeType, placerefs] = row as [string, string | null, string | null, number | null, string | null];
    places.set(handle, {
      name: parseJson(name),
      altNames: parseJson(altNames) ?? [],
      type: placeType ?? -1,
      parents: parseJson(placerefs) ?? [],
    });
  }
  index = { revision: snapshot.revision, loadedCount: snapshot.loadedCount, places };
  titleCache = new Map();
  return places;
}

/** The place's title as the display settings say to show it, or null when
 * the caller should fall back to the stored title: automatic titles off,
 * or the place not cached (yet). `date` is the event's date when this is an
 * event's place -- desktop picks the names and enclosing places valid then
 * (PlaceDisplay.display_event). */
export function displayPlaceTitle(handle: string | null | undefined, date?: GrampsDate | null): string | null {
  if (!handle) return null;
  const settings = getDisplaySettings();
  if (!settings.place.auto) return null;
  const store = placeStore;
  if (!store) return null;
  if (!store.getSnapshot().loadedCount && !placeLoadRequested) {
    // Formatting needs the hierarchy, which lives in the Places cache; a
    // view that shows place titles (Events, Timeline...) may be the first
    // thing to need it this session. Loading emits, which re-renders every
    // useDisplayFormatVersion() subscriber.
    placeLoadRequested = true;
    store.ensureLoaded().catch(() => {
      placeLoadRequested = false;
    });
  }
  // No complete hierarchy yet (see getIndex) -> stored title.
  const places = getIndex(store);
  if (!places) return null;
  if (titleCacheSettings !== settings) {
    titleCache = new Map();
    titleCacheSettings = settings;
  }
  const key = `${handle}|${date?.sortval ?? ""}|${date?.modifier ?? ""}`;
  if (titleCache.has(key)) return titleCache.get(key)!;
  const fmt = settings.place.formats[settings.place.active] ?? settings.place.formats[0];
  const title = formatPlace((h) => places.get(h), handle, fmt, date);
  titleCache.set(key, title);
  return title;
}

/** For the Display settings editor's live example: format with a draft
 * (unsaved) place format. Loads the Places cache if needed; null until it
 * has. */
export function formatPlaceWith(handle: string, fmt: PlaceFormatDef): string | null {
  if (!placeStore) return null;
  if (!placeStore.getSnapshot().loadedCount) {
    placeStore.ensureLoaded().catch(() => {});
    return null;
  }
  const places = getIndex(placeStore);
  return places ? formatPlace((h) => places.get(h), handle, fmt) : null;
}

/** A good place to show formats on: the one with the deepest hierarchy,
 * preferring one that has a populated place (city/town/...) in its chain so
 * "p" offsets show something. Null when no places are cached yet. */
let sample: { places: Map<string, PlaceRecord>; handle: string | null } | null = null;

export function samplePlaceHandle(): string | null {
  if (!placeStore) return null;
  if (!placeStore.getSnapshot().loadedCount) {
    placeStore.ensureLoaded().catch(() => {});
    return null;
  }
  const places = getIndex(placeStore);
  if (!places) return null;
  // One scan per index rebuild, not per render (the editor re-renders on
  // every keystroke).
  if (sample?.places === places) return sample.handle;
  let best: { handle: string; score: number } | null = null;
  for (const handle of places.keys()) {
    const levels = locationList((h) => places.get(h), handle, null, "");
    if (!levels) continue;
    const populated = levels.some(([, type]) => [4, 15, 16, 17].includes(type)) ? 100 : 0;
    const score = populated + levels.length;
    if (!best || score > best.score) best = { handle, score };
  }
  sample = { places, handle: best?.handle ?? null };
  return sample.handle;
}

/** A Gramps date as the display settings say to show it. */
const requestedLocales = new Set<string>();

/** The gramps-date locale for the interface language: the exact code when
 * gramps-date has it ("pt_BR"), else its base language ("de" for "de_CH"),
 * else English. Every language but English loads on demand: until it has,
 * this answers "en" and starts the load, and dates re-render
 * (useDisplayFormatVersion) once it lands. */
export function dateLocaleCode(): string {
  const code = resolveLocaleCode(getI18nSnapshot().lang);
  if (!code) return "en";
  if (isLocaleRegistered(code)) return code;
  if (!requestedLocales.has(code)) {
    requestedLocales.add(code);
    loadLocale(code)
      .then(() => bump())
      .catch(() => requestedLocales.delete(code));
  }
  return "en";
}

/** A Gramps date as the display settings say to show it, in the interface
 * language. */
export function formatDisplayDate(date: GrampsDate | null | undefined): string {
  if (!date) return "";
  try {
    const locale = dateLocaleCode();
    return formatDate(date, { grampsFormat: grampsFormatFor(getDisplaySettings(), locale), locale });
  } catch {
    return "";
  }
}

/** Reads a date typed in the interface language. Text shown by
 * formatDisplayDate reads back to the same date: the tree's format is
 * tried first, which settles formats that look alike (Polish
 * "Miesiąc.Dzień.Rok" 1.4.1789 vs its day-first numeric). */
export function parseDisplayDate(text: string): GrampsDate {
  const locale = dateLocaleCode();
  return parseDate(text, { locale, grampsFormat: grampsFormatFor(getDisplaySettings(), locale) });
}

let version = 0;
let lastPlaceRevision = -1;
const listeners = new Set<() => void>();
function bump() {
  version++;
  for (const listener of listeners) listener();
}
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  subscribeDisplaySettings(bump);
  // Dates are written in the interface language (dateLocaleCode).
  subscribeI18n(bump);
  // Place cache changes only matter while automatic titles are on.
  const watchStores = () => {
    placeStore!.subscribe(() => {
      const revision = placeStore!.getSnapshot().revision;
      if (revision !== lastPlaceRevision && getDisplaySettings().place.auto) {
        lastPlaceRevision = revision;
        bump();
      }
    });
    // Only on load-status changes, not every revision: a background fill
    // emits once per page, and each bump redraws the Tree/Fan charts.
    let lastEventStatus = eventStore!.getSnapshot().status;
    eventStore!.subscribe(() => {
      const status = eventStore!.getSnapshot().status;
      if (status !== lastEventStatus) {
        lastEventStatus = status;
        bump();
      }
    });
  };
  if (placeStore) watchStores();
  else pendingAttach.push(watchStores);
}

function subscribe(listener: () => void): () => void {
  wire();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-render whenever formatted dates/places could have changed: the
 * display settings were loaded or saved, the interface language changed,
 * or the Places cache gained rows.
 * The return value is a cache key for memoized renders. */
export function useDisplayFormatVersion(): number {
  useEffect(() => {
    loadDisplaySettings().catch(() => {});
  }, []);
  return useSyncExternalStore(subscribe, () => version);
}
