import { useEffect, useMemo, useState } from "react";
import { EMPTY_VISUAL_DATA, loadVisualData, readVisualData, type VisualData } from "../store/visualData";
import { useViewStore } from "./useViewStore";

export interface VisualDataState {
  data: VisualData;
  loading: boolean;
  error: string | null;
}

/** The Places + Events data both the Map and the Timeline plot, loaded from
 * the local caches and kept current.
 *
 * `enabled` is the modal's own `opened`: nothing loads until one of the two
 * visuals is actually on screen, so a session that never opens either never
 * pays for the Places/Events caches it wouldn't otherwise have filled.
 * Once loaded it *stays* loaded for the rest of the session (the caches are
 * the views' own, not this hook's), so reopening is instant.
 *
 * Re-reads whenever either cache changes underneath it -- a background fill
 * page landing (loadedCount) or a live-sync patch (revision) -- which is
 * what makes someone else's edit to a place's coordinates show up on an
 * already-open map with no refetch and no reopen. */
export function useVisualData(enabled: boolean): VisualDataState {
  const placeSnapshot = useViewStore("place");
  const eventSnapshot = useViewStore("event");
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
    ],
  );

  return { data, loading, error };
}
