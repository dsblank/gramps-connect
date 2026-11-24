// The Evidence Board's Save: every ticked loose end (changes.ts) goes into
// the tree as ONE transaction through POST /api/transactions/, so it's one
// entry in History and one Undo takes all of it back (EVIDENCE_BOARD_PLAN.md,
// Phase 1; the save-path experiment of 2026-11-24 confirmed the endpoint
// does this, all or nothing).
//
// - New records are sent as `add`s, with Gramps IDs assigned just before
//   sending (grampsIds.ts; the endpoint needs one and doesn't check it's
//   unused -- the small race is accepted, see the plan).
// - Changed existing records are sent as `update`s whose `old` is the
//   record exactly as the board loaded it (records.ts), so the server
//   refuses the whole Save if anyone changed one of them since
//   (TransactionConflictError). Never forced: changedSince() says which
//   records moved on, so the board can reload them and re-apply its loose
//   ends on top.
// - Every record sent is checked first (validate.ts): the endpoint doesn't
//   validate, so a malformed record would otherwise go straight in.
// - The board never deletes records: taking a card off the board or
//   discarding a draft just drops loose ends.
import { canChangeData } from "../../pyodidePoc/grampletCommit";
import { getToken } from "../../auth/auth";
import { assignGrampsIds } from "../grampsIds";
import { postTransaction, type TransactionItem } from "../transactionsApi";
import { applyChanges, sameValue, type Change } from "./changes";
import { loadRecords, type GrampsClass, type GrampsRecord, type Records } from "./records";
import { validateRecords } from "./validate";

export interface SavePlan {
  /** New records, in the order they were created. */
  adds: GrampsRecord[];
  /** Existing records the ticked changes alter: as loaded, and as they'd be saved. */
  updates: { old: GrampsRecord; new: GrampsRecord }[];
}

/** What a Save would send, from the records the board loaded (`base`) and
 * its loose ends. Unticked changes are left out. Throws if a change refers
 * to a record the board never loaded (a bug in the caller: the board must
 * load every record it changes, so the server can check `old`). */
export function planSave(base: Records, changes: Change[]): SavePlan {
  const enabled = changes.filter((c) => !c.off);
  const working = applyChanges(base, enabled);
  const created = enabled.flatMap((c) => c.creates);
  const createdSet = new Set(created);
  const touched = new Set<string>();
  for (const change of enabled) {
    for (const step of change.steps) {
      if (step.k === "create") continue;
      if (!working[step.h]) throw new Error(`A change refers to record ${step.h}, which the board hasn't loaded`);
      touched.add(step.h);
    }
  }
  const adds = created.map((h) => working[h]).filter((r): r is GrampsRecord => !!r);
  const updates = [...touched]
    .filter((h) => !createdSet.has(h) && base[h] && !sameValue(base[h], working[h]))
    .map((h) => ({ old: base[h], new: working[h] }));
  return { adds, updates };
}

/** A Save as the server recorded it: what Undo sends back. */
export interface SavedBoard {
  message: string;
  transaction: TransactionItem[];
  /** handle -> Gramps ID given to each new record. */
  newIds: Record<string, string>;
}

/** Saves the ticked loose ends as one transaction labelled `message` (the
 * History description). Resolves to null when there's nothing to save.
 * Rejects with TransactionConflictError if someone changed one of the
 * records since the board loaded it; nothing is written then. */
export async function saveBoard(base: Records, changes: Change[], message: string): Promise<SavedBoard | null> {
  if (!canChangeData()) throw new Error("Saving needs Editor rights or above.");
  const plan = planSave(base, changes);
  if (!plan.adds.length && !plan.updates.length) return null;
  const needIds = plan.adds.filter((r) => !r.gramps_id);
  const { objects } = await assignGrampsIds(await getToken(), needIds, { builtInFallback: true });
  const ids = new Map(objects.map((o) => [String(o.handle), String(o.gramps_id)]));
  const adds = plan.adds.map((r) => (ids.has(r.handle) ? { ...r, gramps_id: ids.get(r.handle)! } : r));
  const missing = adds.filter((r) => !r.gramps_id);
  if (missing.length) throw new Error(`No Gramps ID could be picked for ${missing.length} new record(s)`);
  // The endpoint doesn't validate, so nothing malformed may leave here.
  validateRecords([...adds, ...plan.updates.map((u) => u.new)]);
  const items: TransactionItem[] = [
    ...adds.map((r): TransactionItem => ({ type: "add", _class: r._class, handle: r.handle, old: null, new: r })),
    ...plan.updates.map((u): TransactionItem => ({ type: "update", _class: u.old._class, handle: u.old.handle, old: u.old, new: u.new })),
  ];
  const transaction = await postTransaction(items, { message });
  return { message, transaction, newIds: Object.fromEntries(ids) };
}

/** Takes back a whole Save as one transaction ("Undo: <message>"). Rejects
 * with TransactionConflictError if a saved record was changed again since. */
export async function undoSave(saved: SavedBoard): Promise<void> {
  await postTransaction(saved.transaction, { undo: true, message: `Undo: ${saved.message}` });
}

/** Which of `records` (as the board loaded them) are no longer the same in
 * the tree: changed (by someone else) or gone. For reloading after a
 * refused Save. The `change` timestamp alone doesn't count, as in the
 * server's own check. */
export async function changedSince(records: GrampsRecord[]): Promise<{ changed: GrampsRecord[]; gone: GrampsRecord[] }> {
  const byClass = new Map<GrampsClass, GrampsRecord[]>();
  for (const r of records) byClass.set(r._class, [...(byClass.get(r._class) ?? []), r]);
  const changed: GrampsRecord[] = [];
  const gone: GrampsRecord[] = [];
  for (const [cls, list] of byClass) {
    const now = await loadRecords(cls, list.map((r) => r.handle));
    for (const r of list) {
      const current = now[r.handle];
      if (!current) gone.push(r);
      else if (!sameValue({ ...r, change: 0 }, { ...current, change: 0 })) changed.push(current);
    }
  }
  return { changed, gone };
}
