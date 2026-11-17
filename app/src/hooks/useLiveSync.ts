import { useEffect, useRef, useState } from "react";
import { pollHistory, type TreeChangeNotification } from "../store/historyPoll";
import { allViewStores, getViewStoresForTable } from "../store/registry";
import type { ViewStore } from "../store/viewStore";
import { publishTreeChange } from "../store/treeChangeBus";
import { getCurrentUsername } from "../auth/auth";
import { recordActivity } from "../store/activeUsers";
import { recordKnownUser } from "../store/knownUsers";

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
 * treeChangeBus.ts, for a consumer that isn't a ViewStore (PyodidePocPanel.tsx),
 * and records each changedBy in activeUsers.ts (see its doc comment) so the
 * header's ActiveUsers avatars stay current without their own poll, and in
 * knownUsers.ts (never decays, unlike activeUsers.ts) so a DM recipient
 * picker has something to suggest beyond who's active right now.
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
    function onNotifications(notifications: TreeChangeNotification[], cursor: number) {
      // Grouped by table so a burst that's large *for one table* (e.g. a
      // bulk import of People) can be told apart from an ordinary handful
      // of unrelated edits spread across several tables in the same tick.
      const byTable = new Map<string, TreeChangeNotification[]>();
      for (const notification of notifications) {
        publishTreeChange(notification);
        if (notification.changedBy) {
          recordActivity(notification.changedBy);
          recordKnownUser(notification.changedBy);
        }
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

      // Every patch this tick per store, so each store persists once, after
      // all of them -- its own table's rows and rows it copies from other
      // tables (refreshDependents) alike.
      const pending = new Map<ViewStore, Promise<unknown>[]>();
      // Stores that started a requery this tick instead: it persists itself
      // once done, and persisting now would stamp the old rows as current.
      const requerying = new Set<ViewStore>();
      const requery = (store: ViewStore) => {
        store.requeryDebounced(cursor);
        requerying.add(store);
      };
      const track = (store: ViewStore, work: Promise<unknown>) => {
        const list = pending.get(store) ?? [];
        list.push(work.catch((err) => console.error("live sync: failed to apply change", err)));
        pending.set(store, list);
      };

      for (const [table, tableNotifications] of byTable) {
        // Rows elsewhere that copy data out of this table's records (Events'
        // place title, ...): the change was recorded against this table
        // only, so those rows are refreshed here or never.
        const changedHandles = tableNotifications.map((n) => n.handle);
        for (const store of allViewStores()) {
          if (store.view.dependsOn?.some((d) => d.table === table)) {
            track(store, store.refreshDependents(table, changedHandles, cursor).then((result) => {
              if (result === "requery") requerying.add(store);
            }));
          }
        }
        for (const store of getViewStoresForTable(table)) {
          // A view with a fixed baseFilter (e.g. Output) can't be
          // incrementally patched by applyLiveChange -- a single thin
          // notification can't tell whether the changed row still matches
          // that filter -- so it gets a full (debounced) requery instead.
          // See ViewStore.requeryDebounced's doc comment.
          if (store.view.baseFilter) {
            requery(store);
            continue;
          }
          // A typed search isn't re-run (whether an edited record still
          // matches is the search's business), but the rows it shows and the
          // whole-tree copy kept aside meanwhile -- what the Map and automatic
          // place titles read -- are kept current. See
          // ViewStore.applyLiveChangesFiltered.
          if (store.getSnapshot().whereExpr !== null) {
            track(store, store.applyLiveChangesFiltered(tableNotifications));
            continue;
          }
          // A big same-table batch (bulk import, mass edit) would otherwise
          // fire two requests per row via applyLiveChange -- collapse it
          // into the one bulk requery requeryDebounced() already does for
          // the cases above, instead of patching row by row.
          if (tableNotifications.length > REQUERY_THRESHOLD) {
            requery(store);
            continue;
          }
          for (const notification of tableNotifications) track(store, store.applyLiveChange(notification));
        }
      }

      // Persisted once each store's whole batch has landed, not per
      // notification -- see ViewStore.persistLiveState's doc comment.
      for (const [store, work] of pending) {
        Promise.all(work).then(() => {
          if (!requerying.has(store)) store.persistLiveState(cursor);
        });
      }
    }

    return pollHistory(onNotifications, setStatus);
  }, []);

  return status;
}
