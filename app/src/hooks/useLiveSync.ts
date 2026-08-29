import { useEffect, useRef, useState } from "react";
import { pollHistory, type TreeChangeNotification } from "../store/historyPoll";
import { getViewStoresForTable } from "../store/registry";
import { publishTreeChange } from "../store/treeChangeBus";
import { getCurrentUsername } from "../auth/auth";

export type LiveSyncStatus = "connecting" | "connected" | "disconnected";

// Above this many same-table changes in one poll tick, patch cost (two
// requests per row via applyLiveChange -- see its doc comment) exceeds one
// bulk requery's, so the view is requeried instead of patched row by row.
// Below it, granular patching wins: no flicker, no refetch of rows that
// didn't change.
const REQUERY_THRESHOLD = 20;

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
    function onNotifications(notifications: TreeChangeNotification[]) {
      // Grouped by table so a burst that's large *for one table* (e.g. a
      // bulk import of People) can be told apart from an ordinary handful
      // of unrelated edits spread across several tables in the same tick.
      const byTable = new Map<string, TreeChangeNotification[]>();
      for (const notification of notifications) {
        publishTreeChange(notification);
        if (
          notification.table === "note" &&
          notification.changedBy &&
          notification.changedBy !== getCurrentUsername()
        ) {
          onRemoteNoteChangeRef.current?.(notification);
        }
        const list = byTable.get(notification.table);
        if (list) list.push(notification);
        else byTable.set(notification.table, [notification]);
      }

      for (const [table, tableNotifications] of byTable) {
        for (const store of getViewStoresForTable(table)) {
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
          // A big same-table batch (bulk import, mass edit) would otherwise
          // fire two requests per row via applyLiveChange -- collapse it
          // into the one bulk requery requeryDebounced() already does for
          // the cases above, instead of patching row by row.
          if (tableNotifications.length > REQUERY_THRESHOLD) {
            store.requeryDebounced();
            continue;
          }
          for (const notification of tableNotifications) {
            store.applyLiveChange(notification).catch((err) => {
              console.error("live sync: failed to apply change", err);
            });
          }
        }
      }
    }

    return pollHistory(onNotifications, setStatus);
  }, []);

  return status;
}
