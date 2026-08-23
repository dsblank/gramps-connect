import { useEffect, useMemo, useState } from "react";
import {
  EMPTY_VISUAL_DATA, loadVisualData, readVisualData, type MapPlace, type VisualData,
} from "../store/visualData";
import { useViewStore } from "./useViewStore";

export interface VisualDataState {
  data: VisualData;
  loading: boolean;
  error: string | null;
}

/** Handle -> resolved position (or null, for "tried and found nothing"),
 * module-level so it survives a Map remount within the session -- fetching
 * and parsing a place's KML file over again every time someone leaves and
 * reopens View > Map would be wasteful, and unlike the ViewStore caches this
 * one has no OPFS/live-sync backing of its own to make that free. */
const kmlPositionCache = new Map<string, [number, number] | null>();

/** The Places + Events data both the Map and the Timeline plot, loaded from
 * the local caches and kept current.
 *
 * `enabled` gates the load, so nothing is fetched until one of the two
 * visuals is actually on screen -- a session that never visits either never
 * pays for the Places/Events caches it wouldn't otherwise have filled. Both
 * callers now simply pass `true`: each is mounted only while its own route
 * is active (App.tsx), so being rendered at all *is* being on screen. Once
 * loaded it stays loaded for the rest of the session (the caches are the
 * views' own, not this hook's), so coming back is instant.
 *
 * Re-reads whenever any of the three caches it draws from changes underneath
 * it -- a background fill page landing (loadedCount) or a live-sync patch
 * (revision) -- which is what makes someone else's edit to a place's
 * coordinates, or a newly-attached KML file's mime becoming known, show up
 * on an already-open map with no refetch and no reopen. */
export function useVisualData(enabled: boolean): VisualDataState {
  const placeSnapshot = useViewStore("place");
  const eventSnapshot = useViewStore("event");
  const mediaSnapshot = useViewStore("media");
  const [error, setError] = useState<string | null>(null);
  // Flipped once the initial ensureLoaded() has resolved. Until then the
  // memo below must not read: an unloaded ViewStore has no db and would
  // read as a legitimately empty tree rather than as "not ready yet".
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled || ready) return;
    let cancelled = false;
    setError(null);
    loadVisualData()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("failed to load map/timeline data", err);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, ready]);

  // Derived, not tracked in its own state. A separate `loading` flag cleared
  // in the promise's own continuation gets stranded at `true` whenever the
  // caches are *already* loaded: setReady(true) re-renders, the effect's deps
  // ([enabled, ready]) change, its cleanup runs and sets cancelled -- and only
  // then does the continuation that would have cleared the flag get to run,
  // where the cancelled guard now (correctly, for its own purposes)
  // suppresses it. That left View > Map spinning forever on a second open,
  // with a fully populated status bar underneath the spinner. Deriving it
  // from the same `ready` the data itself is gated on can't desync that way.
  const loading = enabled && !ready && error === null;

  // Synchronous, imperative read of the caches -- same pull-not-push shape
  // as DataTable's getRows() call, keyed on the snapshot fields that mean
  // "the rows changed" rather than being pushed a copy of them.
  const data = useMemo(
    () => (ready ? readVisualData() : EMPTY_VISUAL_DATA),
    [
      ready,
      placeSnapshot.loadedCount, placeSnapshot.revision,
      eventSnapshot.loadedCount, eventSnapshot.revision,
      mediaSnapshot.loadedCount, mediaSnapshot.revision,
    ],
  );

  // Resolves data.pendingKmlPlaces (a coordinate-less place with a KML
  // attachment) by fetching each one's file(s) and reading a position out of
  // its own coordinates -- KML always carries them (see kmlMedia.ts). Only
  // ever adds markers, never removes one a synchronous read already found,
  // so this can safely lag a render or two behind without the map flashing.
  //
  // Dynamically imported: kmlMedia.ts pulls in @tmcw/togeojson, and this
  // hook (unlike MapCanvas.tsx, which lazy-loads maplibre-gl itself) is used
  // from MapView/TimelineView, which are part of the main bundle -- a tree
  // with no coordinate-less KML attachment (the common case) should never
  // pay for that parser at all.
  const [kmlTick, setKmlTick] = useState(0);
  useEffect(() => {
    const pending = data.pendingKmlPlaces.filter((place) => !kmlPositionCache.has(place.handle));
    if (pending.length === 0) return;
    let cancelled = false;
    import("../store/kmlMedia").then(({ fetchAllKmlFeatures, kmlCenter }) => Promise.all(
      pending.map(async (place) => {
        const features = await fetchAllKmlFeatures(place.kmlMedia);
        kmlPositionCache.set(place.handle, kmlCenter(features));
      }),
    )).then(() => {
      if (!cancelled) setKmlTick((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [data.pendingKmlPlaces]);

  const places = useMemo(() => {
    if (data.pendingKmlPlaces.length === 0) return data.places;
    const derived: MapPlace[] = [];
    for (const place of data.pendingKmlPlaces) {
      const position = kmlPositionCache.get(place.handle);
      if (position) derived.push({ ...place, lat: position[0], long: position[1] });
    }
    return derived.length > 0 ? [...data.places, ...derived] : data.places;
    // `kmlTick` is read for its change alone, to recompute once a pending
    // fetch above resolves -- the cache it reads from is a plain Map, not
    // itself a dependency React can watch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, kmlTick]);

  return { data: places === data.places ? data : { ...data, places }, loading, error };
}
