// POST /api/transactions/: write a set of records as ONE transaction (one
// entry in the tree's History, so one Undo), all or nothing. Shared by
// Gramplet writes (pyodidePoc/grampletCommit.ts) and the Evidence Board's
// Save (board/save.ts).
//
// The endpoint stores records exactly as sent, in Gramps' internal form:
// it doesn't validate them, keep both sides of links in step, or compute
// derived data. Callers must send complete, consistent records. With
// force=false (always, here) it refuses the whole batch if any record's
// `old` no longer matches what's stored, i.e. someone changed it since it
// was read, instead of overwriting their edit. Needs Add + Edit + Delete
// permission (Editor and above).
import { getToken } from "../auth/auth";
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import { apiFetch } from "./apiFetch";
import { describeTaskFailure, waitForTask } from "./taskApi";

export interface TransactionItem {
  type: "add" | "update" | "delete";
  _class: string;
  handle: string;
  old: unknown;
  new: unknown;
}

/** Someone changed one of the records since it was read; nothing was written. */
export class TransactionConflictError extends Error {
  constructor() {
    super("One of these records was changed by someone else since it was read.");
    this.name = "TransactionConflictError";
  }
}

/** Past this many records a transaction runs as a background task (still
 * one transaction), like bulk edits. */
export const TRANSACTION_BACKGROUND_FROM = 500;

/** Sends `items` as one transaction (or, with `undo`, its inverse).
 * Resolves to the transaction as the server recorded it -- what an undo
 * sends back. */
export async function postTransaction(
  items: TransactionItem[],
  options: { message: string; undo?: boolean },
): Promise<TransactionItem[]> {
  const background = items.length > TRANSACTION_BACKGROUND_FROM;
  const query = [
    ...(options.undo ? ["undo=true"] : []),
    ...(background ? ["background=true"] : []),
    `message=${encodeURIComponent(options.message)}`,
  ].join("&");
  const res = await apiFetch(
    `${API_BASE}/api/transactions/?${query}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await getToken()}` },
      body: JSON.stringify(items),
    },
    background ? { lane: "long" } : undefined,
  );
  if (res.status === 202) {
    const { task } = (await res.json()) as { task: { id: string } };
    const status = await waitForTask(task.id);
    if (status.state !== "SUCCESS") {
      const reason = describeTaskFailure(status);
      if (reason.includes("Object has changed")) throw new TransactionConflictError();
      throw new Error(reason);
    }
    return Array.isArray(status.result_object) ? (status.result_object as TransactionItem[]) : [];
  }
  if (!res.ok) {
    const message = await parseErrorMessage(res);
    // apply_transactions()'s own wording for a failed `old` check.
    if (message === "Object has changed") throw new TransactionConflictError();
    throw new Error(message);
  }
  return (await res.json()) as TransactionItem[];
}
