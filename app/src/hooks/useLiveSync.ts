import { useEffect, useState } from "react";
import { pollHistory, type TreeChangeNotification } from "../store/historyPoll";
import { getViewStore } from "../store/registry";

export type LiveSyncStatus = "connecting" | "connected" | "disconnected";

/** Mounts the single history-poll loop for the whole app (one poller, not
 * one per view) -- call once, at the app root, after login. Looks up the
 * changed object's view by its class (see historyPoll.ts's
 * transactionsToNotifications) and patches it -- every view is live-synced
 * this way, not just one hardcoded table, since /api/transactions/history/
 * already reports every object type that changed in one response. */
export function useLiveSync(): LiveSyncStatus {
  const [status, setStatus] = useState<LiveSyncStatus>("connecting");

  useEffect(() => {
    function onNotification(notification: TreeChangeNotification) {
      let store;
      try {
        store = getViewStore(notification.table);
      } catch {
        return; // a changed object type this app has no view for
      }
      // A single thin notification can't tell whether a changed row still
      // belongs in a server-filtered subset -- see ViewStore.applyLiveChange's
      // doc comment; live sync is suspended for that view while filtered.
      if (store.getSnapshot().whereExpr !== null) return;
      store.applyLiveChange(notification).catch((err) => {
        console.error("live sync: failed to apply change", err);
      });
    }

    return pollHistory(onNotification, setStatus);
  }, []);

  return status;
}
