import { useEffect, useState } from "react";
import { LIVE_SYNC_VIEW_KEY, MY_TREE_ID, WS_URL } from "../config";
import { connectLiveSync, shouldApplyNotification, type TreeChangeNotification } from "../store/liveSync";
import { getViewStore } from "../store/registry";

export type LiveSyncStatus = "connecting" | "connected" | "disconnected";

/** Mounts the single relay WebSocket connection for the whole app (one
 * socket, not one per view) -- call once, at the app root, after login.
 * Looks up the target view's store by the notification's table name and
 * patches it, same shape as the original spike's single setupLiveSync()
 * call in main(). */
export function useLiveSync(): LiveSyncStatus {
  const [status, setStatus] = useState<LiveSyncStatus>("connecting");

  useEffect(() => {
    function onNotification(notification: TreeChangeNotification) {
      if (notification.table !== LIVE_SYNC_VIEW_KEY) return;
      const store = getViewStore(LIVE_SYNC_VIEW_KEY);
      const viewWhereExpr = store.getSnapshot().whereExpr;
      if (!shouldApplyNotification({ notification, myTreeId: MY_TREE_ID, liveSyncViewKey: LIVE_SYNC_VIEW_KEY, viewWhereExpr })) {
        return;
      }
      store.applyLiveChange(notification).catch((err) => {
        console.error("live sync: failed to apply change", err);
      });
    }

    const disconnect = connectLiveSync(WS_URL, onNotification, setStatus);
    return disconnect;
  }, []);

  return status;
}
