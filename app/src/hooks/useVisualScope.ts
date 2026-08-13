import { useEffect, useMemo, useState } from "react";
import type { VisualSubject } from "../hash";
import { loadScopeStores, resolveScope, storesNeededFor, type ResolvedScope } from "../store/visualScope";
import { useViewStore } from "./useViewStore";
import type { VisualDataState } from "./useVisualData";

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
export function useVisualScope(subject: VisualSubject | null, visual: VisualDataState): VisualScopeState {
  const { data } = visual;
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

  // Resolution needs the Places/Events caches too, not just the stores
  // above: every branch of resolveScope reaches into `data` for the
  // event->place join, so resolving before useVisualData is done yields a
  // scope with no places at all -- reported to the user as "nothing to plot
  // for this record" for a person whose events are simply still arriving.
  // Gating on the same signal the plot itself waits for keeps the chip and
  // the plot telling one story.
  const dataReady = !visual.loading && visual.error === null;

  const scope = useMemo(
    () => (subject && ready && dataReady ? resolveScope(subject, data) : null),
    [
      subject?.type, subject?.handle, ready, dataReady, data,
      personSnapshot.loadedCount, personSnapshot.revision,
      familySnapshot.loadedCount, familySnapshot.revision,
    ],
  );

  return {
    scope,
    // Still loading until *both* halves are ready. Only once they are does
    // a null scope mean what the chip says it means -- a handle this cache
    // genuinely doesn't have (a stale link, or a background fill that
    // hasn't reached it yet) rather than one it hasn't got to.
    loading: subject !== null && (!ready || visual.loading) && error === null,
    error: error ?? visual.error,
  };
}
