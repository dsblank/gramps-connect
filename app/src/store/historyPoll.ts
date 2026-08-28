// Polls gramps-web-api's existing GET /api/transactions/history/ endpoint
// instead of holding a relay WebSocket open (see git history for the old
// store/liveSync.ts + dev-fixtures/layer3-sync/relay.py + triggers.sql,
// removed once this replaced them). Same downstream consumer contract as
// before (see ../hooks/useLiveSync.ts): one TreeChangeNotification per real
// object change. The cursor here is just a transaction id on a plain
// authenticated GET, not a persistent connection to a Postgres-fronting
// relay process -- a missed poll (tab backgrounded, laptop asleep) simply
// gets caught up on the next one, and it works against any backend
// (sqlite included), not just Postgres.
import { API_BASE } from "../config";
import { getToken } from "../auth/auth";

export type TreeChangeOp = "INSERT" | "UPDATE" | "DELETE";

export interface TreeChangeNotification {
  /** The changed object's view key, e.g. "person" -- obj_class.toLowerCase(). */
  table: string;
  handle: string;
  op: TreeChangeOp;
  /** The acting user's username, or null if the transaction carried none
   * (e.g. a system-driven change). Sourced from the transaction's own
   * `connection.user.name` -- gramps-web-api's history.py already resolves
   * this server-side (fix_transaction_user), it's just not read here until
   * now. */
  changedBy: string | null;
}

interface HistoryChange {
  obj_class: string;
  trans_type: number;
  obj_handle: string;
}

interface HistoryTransaction {
  // Only read by pollHistory()'s own after_id bookkeeping below --
  // transactionsToNotifications() (and its tests) never touch it.
  id: number;
  timestamp: number;
  changes: HistoryChange[];
  connection?: { user?: { name: string | null } | null };
}

const TRANS_TYPE_TO_OP: Record<number, TreeChangeOp> = { 0: "INSERT", 1: "UPDATE", 2: "DELETE" };

// gramps.gen.db.REFERENCE_KEY -- backlink bookkeeping rows the undo log
// also records, not a real primary-object change. gramps-web-api's own
// history.py filters these out the same way when reconstructing a
// transaction for undo.
const REFERENCE_OBJ_CLASS = "7";

const POLL_INTERVAL_MS = 5000;

/** Pure: collapses a batch of /api/transactions/history/ transactions into
 * at most one notification per (obj_class, handle) -- the net effect
 * across the whole batch, so e.g. two updates to the same person within
 * one poll window only trigger one refetch, and a later delete always
 * wins over an earlier add/update to the same handle. Exported separately
 * from pollHistory() so this mapping/collapsing logic is directly
 * testable without mocking fetch/timers. */
export function transactionsToNotifications(transactions: HistoryTransaction[]): TreeChangeNotification[] {
  const net = new Map<string, { change: HistoryChange; changedBy: string | null }>();
  for (const tx of transactions) {
    const changedBy = tx.connection?.user?.name ?? null;
    for (const change of tx.changes) {
      if (change.obj_class === REFERENCE_OBJ_CLASS) continue;
      net.set(`${change.obj_class}:${change.obj_handle}`, { change, changedBy });
    }
  }
  return Array.from(net.values()).map(({ change, changedBy }) => ({
    table: change.obj_class.toLowerCase(),
    handle: change.obj_handle,
    op: TRANS_TYPE_TO_OP[change.trans_type],
    changedBy,
  }));
}

/** Polls GET /api/transactions/history/?after_id=<cursor> on a fixed
 * interval and calls onNotification once per real (non-reference) object
 * change -- a background enhancement (the app is fully usable without it,
 * just not live) rather than something worth failing loudly over. Returns a
 * cleanup function that stops polling.
 *
 * Cursors on the transaction `id`, not `timestamp`: the timestamp-based
 * `after` param is a float compared server-side as `after * 1e9`, and that
 * round-trip (server float -> JS double -> string -> back to a server
 * float) loses enough precision that the same last transaction can compare
 * as "still after the cursor" forever -- an infinite redelivery loop where
 * every 5s poll re-reports the same stale change (e.g. re-running every
 * Gramplet on every tick, see git history for the bug report). `after_id`
 * is an exact integer compare, no precision loss. See gramps-web-api's
 * TransactionsHistoryQueryArgs.after_id docstring. */
export function pollHistory(
  onNotification: (notification: TreeChangeNotification) => void,
  onStatus?: (status: "connected" | "disconnected") => void
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Only changes from here forward -- ViewStore.ensureLoaded() already
  // fetched current state via the normal /query/ endpoints. Seeded from the
  // newest existing transaction id on the first poll tick below (0 would
  // mean "from the beginning", replaying the whole history).
  let afterId = 0;
  let bootstrapped = false;

  async function poll() {
    if (stopped) return;
    try {
      const token = await getToken();
      if (!bootstrapped) {
        const res = await fetch(
          `${API_BASE}/api/transactions/history/?after_id=0&page=1&pagesize=1&sort=-id`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) throw new Error(`history poll bootstrap failed: ${res.status}`);
        const latest: HistoryTransaction[] = await res.json();
        afterId = latest[0]?.id ?? 0;
        bootstrapped = true;
      }
      const res = await fetch(`${API_BASE}/api/transactions/history/?after_id=${afterId}&sort=id`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`history poll failed: ${res.status}`);
      const transactions: HistoryTransaction[] = await res.json();
      onStatus?.("connected");

      if (transactions.length > 0) {
        for (const notification of transactionsToNotifications(transactions)) {
          onNotification(notification);
        }
        afterId = Math.max(...transactions.map((t) => t.id));
      }
    } catch (err) {
      console.error("history poll failed", err);
      onStatus?.("disconnected");
    } finally {
      if (!stopped) timer = setTimeout(poll, POLL_INTERVAL_MS);
    }
  }
  poll();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
