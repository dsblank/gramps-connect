import { useEffect, useRef, useState } from "react";
import { formatHash, parseHash } from "../hash";
import { getViewStore } from "../store/registry";
import { useViewStore } from "./useViewStore";

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
export function useHistorySync(): { activeKey: string; setActiveKey: (key: string) => void } {
  const [activeKey, setActiveKey] = useState(() => parseHash().viewKey);
  const activeSnapshot = useViewStore(activeKey);
  // True while a hashchange is still being applied to store state -- see
  // the outward effect's comment below on the race this closes.
  const applyingHash = useRef(false);

  useEffect(() => {
    async function applyHash() {
      applyingHash.current = true;
      try {
        const { viewKey, handle } = parseHash();
        setActiveKey(viewKey);
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
    const next = formatHash({ viewKey: activeKey, handle: activeSnapshot.selectedHandle });
    if (window.location.hash !== next) {
      window.location.hash = next;
    }
  }, [activeKey, activeSnapshot.selectedHandle]);

  return { activeKey, setActiveKey };
}
