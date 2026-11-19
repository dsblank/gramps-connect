// The current user's own edits, for View > Visited's Activity tab, read
// from gramps-web-api's transaction history rather than recorded in the
// browser (activityLog.ts): the history already has every change with its
// time and user, and reading it there shows edits made on any device.
//
// The endpoint can't filter by user, so this reads the time window's
// transactions, newest first, and keeps this user's. Needs the
// view-private permission the endpoint requires; without it (a Guest) the
// tab simply shows no edits.
import { API_BASE } from "../config";
import { apiFetch } from "./apiFetch";

export type EditOp = "added" | "edited" | "deleted";

export interface EditChange {
  /** A VIEWS key, e.g. "person". */
  type: string;
  handle: string;
  op: EditOp;
}

export interface EditEntry {
  kind: "edit";
  at: number;
  txId: number;
  /** Primary-object changes only (backlink rows left out), in order. */
  changes: EditChange[];
  /** An undo of an earlier transaction. */
  undo: boolean;
}

interface RawTransaction {
  id: number;
  timestamp: number;
  undo?: boolean;
  changes: { obj_class: string; trans_type: number; obj_handle: string }[];
  connection?: { user?: { name: string | null } | null };
}

const OPS: Record<number, EditOp> = { 0: "added", 1: "edited", 2: "deleted" };

// gramps.gen.db.REFERENCE_KEY: backlink bookkeeping, not a real change
// (same filter as historyPoll.ts).
const REFERENCE_OBJ_CLASS = "7";

const PAGESIZE = 500;
/** Enough for a busy shared tree; past it the oldest edits in the window
 * just don't show. */
const MAX_PAGES = 6;

/** Pure: this user's transactions as edit entries, oldest first. */
export function toEditEntries(transactions: RawTransaction[], username: string): EditEntry[] {
  const entries: EditEntry[] = [];
  for (const tx of transactions) {
    if (tx.connection?.user?.name !== username) continue;
    const seen = new Set<string>();
    const changes: EditChange[] = [];
    for (const c of tx.changes ?? []) {
      if (c.obj_class === REFERENCE_OBJ_CLASS || !OPS[c.trans_type]) continue;
      const type = c.obj_class.toLowerCase();
      const key = `${type}:${c.obj_handle}`;
      if (seen.has(key)) continue;
      seen.add(key);
      changes.push({ type, handle: c.obj_handle, op: OPS[c.trans_type] });
    }
    if (changes.length === 0) continue;
    entries.push({ kind: "edit", at: Math.floor(tx.timestamp), txId: tx.id, changes, undo: !!tx.undo });
  }
  return entries.sort((a, b) => a.at - b.at || a.txId - b.txId);
}

/** This user's edits since `after` (Unix seconds), oldest first. Throws on
 * a failed request; the caller decides how quiet to be about it. */
export async function fetchOwnEdits(token: string, username: string, after: number): Promise<EditEntry[]> {
  const transactions: RawTransaction[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      sort: "-id",
      page: String(page),
      pagesize: String(PAGESIZE),
      after: String(after),
    });
    const res = await apiFetch(`${API_BASE}/transactions/history/?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`transaction history: HTTP ${res.status}`);
    const batch = (await res.json()) as RawTransaction[];
    transactions.push(...batch);
    if (batch.length < PAGESIZE) break;
  }
  return toEditEntries(transactions, username);
}
