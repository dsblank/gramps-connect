import { useEffect, useState } from "react";
import { pollHistory, type TreeChangeNotification } from "../store/historyPoll";
import { getViewStoresForTable } from "../store/registry";

export type LiveSyncStatus = "connecting" | "connected" | "disconnected";

/** Mounts the single history-poll loop for the whole app (one poller, not
 * one per view) -- call once, at the app root, after login. Looks up every
 * view backed by the changed object's table (see historyPoll.ts's
 * transactionsToNotifications, registry.ts's getViewStoresForTable) and
 * patches each -- more than one view can be backed by the same table (e.g.
 * "media" and "generated" both watch Media), so a notification isn't routed
 * to just one. Every view is live-synced this way, not just one hardcoded
 * table, since /api/transactions/history/ already reports every object type
 * that changed in one response. */
export function useLiveSync(): LiveSyncStatus {
  const [status, setStatus] = useState<LiveSyncStatus>("connecting");

  useEffect(() => {
    function onNotification(notification: TreeChangeNotification) {
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
