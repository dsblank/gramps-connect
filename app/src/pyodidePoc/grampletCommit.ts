// Saving a real run's changes, and undoing them -- the main-thread half of
// changesBootstrap.ts's commits (see GRAMPLET_WRITES_PLAN.md). Each group of
// changes a Gramplet closes is one POST /api/transactions/: atomic, and with
// force=false (the default) the server refuses the whole group if any
// record's `old` no longer matches what's stored -- i.e. someone changed it
// since the Gramplet read it -- instead of overwriting their edit. The
// endpoint doesn't validate objects, which is why the worker checks each one
// against its Gramps schema before it gets here.
import { hasPermissions } from "../auth/auth";
import { postTransaction } from "../store/transactionsApi";
import type { TransactionItem } from "./types";

/** /api/transactions/ needs all three, i.e. Editor and above. */
export const CHANGE_DATA_PERMISSIONS = ["AddObject", "EditObject", "DeleteObject"];

export function canChangeData(): boolean {
  return hasPermissions(...CHANGE_DATA_PERMISSIONS);
}

/** A saved group: the transaction exactly as the server recorded it, which
 * is what ?undo=true takes back. */
export interface CommittedGroup {
  message: string;
  transaction: TransactionItem[];
}

export async function commitChangeGroup(message: string, items: TransactionItem[]): Promise<CommittedGroup> {
  if (!canChangeData()) throw new Error("Saving changes needs Editor rights or above.");
  const transaction = await postTransaction(items, { message });
  return { message, transaction };
}

/** Undoes `groups`, last first, each as its own transaction. Stops at the
 * first one the server refuses (most likely: one of its records has been
 * changed again since), saying how many were already undone. */
export async function undoCommittedGroups(groups: CommittedGroup[]): Promise<void> {
  const reversed = [...groups].reverse();
  for (const [i, group] of reversed.entries()) {
    try {
      await postTransaction(group.transaction, { undo: true, message: `Undo: ${group.message}` });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(i === 0 ? reason : `Undid ${i} of ${reversed.length} groups, then: ${reason}`);
    }
  }
}
