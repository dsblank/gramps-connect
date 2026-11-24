import { useCallback, useEffect, useRef, useState } from "react";
import { BOARD_KEY, formatHash, HOME_KEY, isBoardKey, isForeignRoute, isStorelessKey, isVisualKey, parseHash, type VisualSubject } from "../hash";
import { getViewStore } from "../store/registry";
import { VIEWS } from "../store/views";
import { useViewStore } from "./useViewStore";
import { isVisitable, recordVisit } from "../store/visitedHistory";
import { installActivityAwayTracking, logActivity } from "../store/activityLog";

/** How long a record has to stay selected to count as a visit
 * (View > Visited): long enough that arrowing through a list doesn't
 * record every row it passes, short enough that a glance still counts. */
const VISIT_DWELL_MS = 1000;

/** A link to a tree other than the one this session is signed in to --
 * see hash.ts's isForeignRoute. */
export interface ForeignTreeLink {
  treeId: string;
  /** The link itself, so it can be put back in the address bar before
   * signing out (signing in again then lands on it). */
  hash: string;
}

/** The location's route, or Home in its place when the route belongs to
 * another tree: its handles mean nothing here, so nothing of it is applied. */
function readLocalRoute() {
  const route = parseHash();
  return isForeignRoute(route) ? { ...route, viewKey: HOME_KEY, handle: null, subject: null } : route;
}

function readForeign(): ForeignTreeLink | null {
  const route = parseHash();
  return isForeignRoute(route) ? { treeId: route.treeId!, hash: window.location.hash } : null;
}

/** Keeps the URL hash, the active sidebar tab, and the active view's
 * DataTable selection in sync with each other -- so the browser's native
 * Back/Forward step through every view switch and every person (or other
 * row) visited, and a reload lands back on the same one. Replaces App.tsx's
 * plain `useState(VIEWS[0].key)` for activeKey.
 *
 * Sync runs in both directions:
 *  - state -> hash: whenever activeKey or the active view's selectedHandle
 *    changes, the hash is updated to match -- setting `location.hash`
 *    pushes a real, Back-navigable history entry (the browser does this
 *    for free; no history-API bookkeeping needed).
 *  - hash -> state: a hashchange listener (native Back/Forward, a manual
 *    URL edit, or the initial load) re-applies the parsed route --
 *    switching tabs and/or calling the target view's
 *    navigateToHandle()/clearSelection().
 * The equality checks in both effects are what keep this from looping: a
 * self-triggered hashchange re-applies a route that's already current, so
 * neither direction fires a second time. */
export function useHistorySync(): {
  activeKey: string;
  setActiveKey: (key: string) => void;
  /** The record the active visual page is scoped to, or null (always null
   * when the active route isn't a visual). Read from the hash rather than
   * held anywhere else -- see hash.ts's VisualSubject. */
  visualSubject: VisualSubject | null;
  /** Set when the URL named another tree -- shown to the user (App.tsx's
   * ForeignTreeDialog) rather than applied; cleared by dismissForeignTree. */
  foreignTree: ForeignTreeLink | null;
  dismissForeignTree: () => void;
  /** The case the Evidence Board shows (a case-file Note handle, or
   * "new-<id>"), or null when the board isn't the active route. */
  boardCase: string | null;
  /** Points the board's route at another case without a history step --
   * for a new case's first Save, which gives it a real handle. */
  replaceBoardCase: (handle: string) => void;
} {
  const [activeKey, setActiveKey] = useState(() => readLocalRoute().viewKey);
  const [foreignTree, setForeignTree] = useState<ForeignTreeLink | null>(readForeign);
  // The last route this hook wrote or applied -- where a foreign link
  // pasted mid-session sends the address bar back to.
  const lastLocalHash = useRef<string | null>(null);
  // Mirrors the route's subject. Held in state (rather than re-parsed at
  // each render) so the outward effect below has something to write back
  // *from*: without it, that effect would reformat a scoped visual route as
  // its bare "#/map" self and immediately throw the scope away again.
  const [visualSubject, setVisualSubject] = useState<VisualSubject | null>(() => readLocalRoute().subject);
  // Mirrors the board route's case, for the same reason as visualSubject.
  const [boardCase, setBoardCase] = useState<string | null>(() => {
    const route = readLocalRoute();
    return isBoardKey(route.viewKey) ? route.handle : null;
  });
  // A visual page (#/map, #/timeline) or Home (#/home) is a route but not a
  // view: it has no store, so there's no snapshot to sync and
  // getViewStore() would throw on its key. Subscribe to the first view
  // instead of skipping the hook -- its snapshot is simply unused below
  // while one of those is active. `visual` (narrower than `noStore`) gates
  // only the subject-writing logic further down: Home never carries one.
  const visual = isVisualKey(activeKey);
  const noStore = isStorelessKey(activeKey);
  const activeSnapshot = useViewStore(noStore ? VIEWS[0].key : activeKey);
  // True while a hashchange is still being applied to store state -- see
  // the outward effect's comment below on the race this closes.
  const applyingHash = useRef(false);

  useEffect(() => {
    async function applyHash() {
      applyingHash.current = true;
      try {
        const route = parseHash();
        if (isForeignRoute(route)) {
          setForeignTree({ treeId: route.treeId!, hash: window.location.hash });
          // Mid-session (a pasted link), nothing else would undo it: the
          // outward effect below only runs when the route state changes, and
          // that's exactly what isn't happening. On the initial load the
          // state is already Home (readLocalRoute), and that effect replaces
          // the URL itself.
          if (lastLocalHash.current) {
            window.history.replaceState(window.history.state, "", lastLocalHash.current);
          }
          return;
        }
        lastLocalHash.current = formatHash(route.treeId === null ? { ...route, treeId: undefined } : route);
        const { viewKey, handle, subject } = route;
        setActiveKey(viewKey);
        setVisualSubject(subject);
        setBoardCase(isBoardKey(viewKey) ? handle : null);
        if (isStorelessKey(viewKey)) return; // nothing to select -- see `noStore` above
        const store = getViewStore(viewKey);
        if (handle) {
          if (store.getSnapshot().selectedHandle !== handle) {
            await store.navigateToHandle(handle);
          }
        } else {
          store.clearSelection();
        }
      } catch (err) {
        console.error("failed to apply history navigation", err);
      } finally {
        applyingHash.current = false;
      }
    }
    applyHash(); // the initial URL may already carry a handle (a reload, or a pasted link)
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  useEffect(() => {
    // Skip while applyHash() above is still resolving a jump to a
    // different view: the render right after activeKey flips to it (but
    // before its navigateToHandle() call resolves) sees that view's
    // *stale* selectedHandle -- often null, on its first-ever activation
    // -- and would otherwise "correct" the hash back down to that stale
    // value, even though the hash is already exactly right (it's what
    // triggered applyHash in the first place). That spurious correction
    // used to leave an extra, wrong "no selection" entry in browser
    // history between every cross-view jump, before self-healing a moment
    // later once navigateToHandle actually finished.
    if (applyingHash.current) return;
    // A *default* selection (ViewStore.applyDefaultSelection -- the first
    // row, auto-selected so the detail panes are never empty) is
    // deliberately not mirrored here: the hash should say what the user
    // chose, and every visit to this view already lands on that row
    // anyway. Writing it would push a spurious history entry per view
    // switch, and Back onto the resulting handle-less `#view` route would
    // re-derive the same default and push it straight back again.
    const next = formatHash({
      viewKey: activeKey,
      // A visual or Home page carries no handle, and the snapshot read here
      // is some other view's (see `noStore` above) -- appending its
      // selection would make up a route that doesn't exist.
      handle: isBoardKey(activeKey) ? boardCase : noStore || activeSnapshot.selectionIsDefault ? null : activeSnapshot.selectedHandle,
      // ...a visual carries a subject instead, and only while it's the
      // active route: a stale subject left over from a visual would
      // otherwise be formatted onto an ordinary view's hash, where
      // formatHash ignores it but nothing else would have cleared it.
      subject: visual ? visualSubject : null,
    });
    lastLocalHash.current = next;
    if (window.location.hash !== next) {
      const current = parseHash();
      // An older link with no tree formats, here, with this session's --
      // so a fresh load of one just gets the tree spelled in.
      if (formatHash({ ...current, treeId: current.treeId ?? undefined }) === next || isForeignRoute(current)) {
        // Same route, only spelled differently -- most often a fresh load
        // with no hash at all, which parses as Home. Rewrite it in place:
        // pushing it would leave a Back step onto the unspelled URL, which
        // just redirects here again (and wipes Forward on the way), so the
        // header's Back button (HistoryNav.tsx) would look stuck. Same URL
        // semantics, so no hashchange is needed or fired. A foreign link
        // (loaded fresh, so the state here is Home) is replaced for the same
        // reason: Back onto it would only raise the same notice again.
        window.history.replaceState(window.history.state, "", next);
      } else {
        window.location.hash = next;
      }
    }
    // selectionIsDefault is a dependency in its own right, not just a
    // derived read: clicking the very row that was already auto-selected
    // leaves selectedHandle unchanged and only flips this flag -- which is
    // exactly the moment that handle has to start appearing in the hash.
  }, [visual, noStore, visualSubject, boardCase, activeKey, activeSnapshot.selectedHandle, activeSnapshot.selectionIsDefault]);

  // A record the user picked (a row click, Back/Forward onto it, a link
  // to it), never a view's automatic first-row selection -- the same rule
  // the hash itself follows above. Recorded once it has stayed selected
  // for VISIT_DWELL_MS.
  const visitHandle = noStore || activeSnapshot.selectionIsDefault ? null : activeSnapshot.selectedHandle;
  useEffect(() => {
    if (!visitHandle || !isVisitable(activeKey)) return;
    const timer = setTimeout(() => recordVisit(activeKey, visitHandle), VISIT_DWELL_MS);
    return () => clearTimeout(timer);
  }, [activeKey, visitHandle]);

  // Every page that settles for the same dwell is a step in View >
  // Visited's Activity tab (activityLog.ts): a record, a list, or a visual
  // and its subject. Same "user picked it" rule as the visit above.
  const subjectType = visual ? visualSubject?.type : undefined;
  const subjectHandle = visual ? visualSubject?.handle : undefined;
  useEffect(() => {
    const timer = setTimeout(() => {
      logActivity({
        kind: "route",
        viewKey: activeKey,
        ...(visitHandle ? { handle: visitHandle } : {}),
        ...(subjectType && subjectHandle ? { subject: { type: subjectType, handle: subjectHandle } } : {}),
      });
    }, VISIT_DWELL_MS);
    return () => clearTimeout(timer);
  }, [activeKey, visitHandle, subjectType, subjectHandle]);

  useEffect(() => installActivityAwayTracking(), []);

  const dismissForeignTree = useCallback(() => setForeignTree(null), []);
  const replaceBoardCase = useCallback((handle: string) => {
    const next = formatHash({ viewKey: BOARD_KEY, handle });
    lastLocalHash.current = next;
    window.history.replaceState(window.history.state, "", next);
    setBoardCase(handle);
  }, []);

  return { activeKey, setActiveKey, visualSubject, foreignTree, dismissForeignTree, boardCase, replaceBoardCase };
}
