import { useEffect, useRef, useState } from "react";
import { pollHistory, type TreeChangeNotification } from "../store/historyPoll";
import { getViewStoresForTable } from "../store/registry";
import { publishTreeChange } from "../store/treeChangeBus";
import { getCurrentUsername } from "../auth/auth";

export type LiveSyncStatus = "connecting" | "connected" | "disconnected";

/** Mounts the single history-poll loop for the whole app (one poller, not
 * one per view) -- call once, at the app root, after login. Looks up every
 * view backed by the changed object's table (see historyPoll.ts's
 * transactionsToNotifications, registry.ts's getViewStoresForTable) and
 * patches each -- more than one view can be backed by the same table (e.g.
 * "media" and "generated" both watch Media), so a notification isn't routed
 * to just one. Every view is live-synced this way, not just one hardcoded
 * table, since /api/transactions/history/ already reports every object type
 * that changed in one response. Also fans every notification out over
 * treeChangeBus.ts, for a consumer that isn't a ViewStore (PyodidePocPanel.tsx).
 *
 * `onRemoteNoteChange`, if given, fires for Notes-table changes made by
 * someone other than the current user (v1 scope: Notes only, not every
 * table -- a blanket any-table toast would be noisy on an active tree).
 * Held in a ref rather than the effect's own deps so a new callback
 * identity each render doesn't restart the poll loop. */
export function useLiveSync(onRemoteNoteChange?: (notification: TreeChangeNotification) => void): LiveSyncStatus {
  const [status, setStatus] = useState<LiveSyncStatus>("connecting");
  const onRemoteNoteChangeRef = useRef(onRemoteNoteChange);
  onRemoteNoteChangeRef.current = onRemoteNoteChange;

  useEffect(() => {
    function onNotification(notification: TreeChangeNotification) {
      publishTreeChange(notification);
      if (
        notification.table === "note" &&
        notification.changedBy &&
        notification.changedBy !== getCurrentUsername()
      ) {
        onRemoteNoteChangeRef.current?.(notification);
      }
      for (const store of getViewStoresForTable(notification.table)) {
        // A view with a fixed baseFilter (e.g. Output) can't be
        // incrementally patched by applyLiveChange -- a single thin
        // notification can't tell whether the changed row still matches
        // that filter -- so it gets a full (debounced) requery instead.
        // See ViewStore.requeryDebounced's doc comment.
        if (store.view.baseFilter) {
          store.requeryDebounced();
          continue;
        }
        // Same reasoning, for a view's ad hoc user-typed filter (see
        // ViewStore.applyLiveChange's doc comment): live sync is suspended
        // for that view while filtered, rather than requeried, since an ad
        // hoc filter isn't expected to always reflect the very latest data
        // the moment it changes.
        if (store.getSnapshot().whereExpr !== null) continue;
        store.applyLiveChange(notification).catch((err) => {
          console.error("live sync: failed to apply change", err);
        });
      }
    }

    return pollHistory(onNotification, setStatus);
  }, []);

  return status;
}
