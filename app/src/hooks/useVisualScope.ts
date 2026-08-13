import { useEffect, useMemo, useState } from "react";
import type { VisualSubject } from "../hash";
import { loadScopeStores, resolveScope, storesNeededFor, type ResolvedScope } from "../store/visualScope";
import type { VisualData } from "../store/visualData";
import { useViewStore } from "./useViewStore";

export interface VisualScopeState {
  /** null whenever the route carries no subject, and also while one is
   * still resolving or has turned out to be unresolvable -- callers show
   * the whole tree in all three cases. `loading`/`error` distinguish them
   * for the chip. */
  scope: ResolvedScope | null;
  loading: boolean;
  error: string | null;
}

/** Resolves the routed subject (see hash.ts) against the caches, loading
 * whatever extra view stores that needs first.
 *
 * The companion to useVisualData: that hook loads the Places and Events
 * caches the visuals *plot*, this one loads the Person/Family caches a
 * subject is *resolved from*. Split rather than folded in because the
 * second is conditional -- an unscoped map, or one scoped to a place, never
 * touches the People cache at all, and shouldn't pay to download it. */
export function useVisualScope(subject: VisualSubject | null, data: VisualData): VisualScopeState {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subscribed so a subject resolves as soon as its store finishes loading
  // (and re-resolves when a live-sync patch or a background-fill page
  // changes it underneath) -- same pull-not-push shape as useVisualData.
  // Both are subscribed unconditionally: hooks can't be called
  // conditionally, and subscribing to a store nobody has loaded is free.
  const personSnapshot = useViewStore("person");
  const familySnapshot = useViewStore("family");

  const needed = storesNeededFor(subject).join(",");
  useEffect(() => {
    if (!subject) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    loadScopeStores(subject)
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("failed to load data for the visual's subject", err);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // Keyed on which stores are needed and which record is wanted, not on
    // the subject object's identity -- parseHash builds a fresh one on
    // every hashchange, and re-running this on each would re-flip `ready`
    // and flash the chip back to "loading" for an unchanged route.
  }, [subject?.type, subject?.handle, needed]);

  const scope = useMemo(
    () => (subject && ready ? resolveScope(subject, data) : null),
    [
      subject?.type, subject?.handle, ready, data,
      personSnapshot.loadedCount, personSnapshot.revision,
      familySnapshot.loadedCount, familySnapshot.revision,
    ],
  );

  return {
    scope,
    // A subject that resolved to null once its stores are loaded isn't
    // loading any more -- it's a handle this cache doesn't have (a stale
    // link, or a fill that hasn't reached it). The visuals fall back to the
    // whole tree either way; only the chip needs to tell them apart.
    loading: subject !== null && !ready && error === null,
    error,
  };
}
