// WebSocket connection to dev-fixtures/layer3-sync's relay (see
// ../../dev-fixtures/layer3-sync/relay.py) plus the pure guard logic
// deciding whether a notification should be applied to a given view's
// cache -- ported from the original Layer 2/3 spike's browser.ts
// (setupLiveSync/applyLiveChange; since removed, see git history).
export interface TreeChangeNotification {
  treeid: number;
  table: string;
  handle: string;
  op: "INSERT" | "UPDATE" | "DELETE";
}

export interface LiveSyncGuardParams {
  notification: TreeChangeNotification;
  myTreeId: number;
  liveSyncViewKey: string;
  /** The target view's current where_expr, or null if unfiltered. */
  viewWhereExpr: string | null;
}

/** Pure predicate: should this notification be applied to the target
 * view's cache? Scoped to one hardcoded view (person) for this first pass
 * (see LIVE_SYNC_VIEW_KEY in ../config.ts) -- a notification for any other
 * table is ignored entirely. Live sync is also suspended whenever a
 * where_expr filter is active: the local cache then holds only a
 * server-filtered subset, and naively patching/inserting into it can't
 * tell whether a changed row still belongs in that subset without
 * re-running the filter, which a single thin
 * {treeid, table, handle, op} notification can't answer on its own. */
export function shouldApplyNotification({
  notification,
  myTreeId,
  liveSyncViewKey,
  viewWhereExpr,
}: LiveSyncGuardParams): boolean {
  if (notification.treeid !== myTreeId) return false;
  if (notification.table !== liveSyncViewKey) return false;
  if (viewWhereExpr !== null) return false;
  return true;
}

/** Opens the relay WebSocket and calls onNotification for each parsed
 * message, reconnecting with a fixed backoff on drop -- this is a
 * background enhancement (the app is fully usable without it, just not
 * live) rather than something worth failing loudly over. Returns a cleanup
 * function that stops reconnecting and closes the socket. */
export function connectLiveSync(
  wsUrl: string,
  onNotification: (notification: TreeChangeNotification) => void,
  onStatus?: (status: "connected" | "disconnected") => void
): () => void {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (stopped) return;
    ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => onStatus?.("connected"));
    ws.addEventListener("message", (event) => {
      let notification: TreeChangeNotification;
      try {
        notification = JSON.parse(event.data);
      } catch {
        return; // malformed message, ignore
      }
      onNotification(notification);
    });
    ws.addEventListener("close", () => {
      onStatus?.("disconnected");
      if (!stopped) reconnectTimer = setTimeout(connect, 3000);
    });
  }
  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}
