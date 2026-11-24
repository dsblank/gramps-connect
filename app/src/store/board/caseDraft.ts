// Unsaved Evidence Board work, kept in this browser between visits: the
// loose ends not saved yet, and the board's layout since its last Save
// (cards moved or pinned up, sticky notes). Layout changes stay here until
// Save on purpose, so History doesn't fill with "moved a card"
// (EVIDENCE_BOARD_PLAN.md, Phase 2).
//
// A draft also records the `change` time of every existing record its
// loose ends touch, as they were when the loose end was made. Opening the
// case compares those with the tree (caseLoad.ts): a loose end whose
// record moved on since is unticked for review instead of being re-applied
// blindly over someone else's edit.
//
// One draft per case, per tree and user (storageKeys.ts). A case that has
// never been saved is keyed "new:<id>".
import { getCurrentUsername, getTreeId } from "../../auth/auth";
import { boardDraftKey } from "../storageKeys";
import type { Change } from "./changes";
import type { CaseFile } from "./caseFile";
import type { GrampsClass } from "./records";

export const CASE_DRAFT_VERSION = 1;

export interface CaseDraft {
  version: typeof CASE_DRAFT_VERSION;
  /** The case-file Note's `change` time the draft was made against, or
   * null for a case never saved. A different time on opening means the
   * case was saved elsewhere since, so this draft's layout is out of date. */
  noteChange: number | null;
  /** The board's layout, unsaved. */
  file: CaseFile;
  changes: Change[];
  /** handle -> type and `change` time of each existing record the loose
   * ends touch, when they were made. */
  seen: Record<string, { class: GrampsClass; change: number }>;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // blocked storage
  }
}

function keyFor(caseKey: string): string {
  return boardDraftKey(getTreeId() ?? "unknown", getCurrentUsername() ?? "", caseKey);
}

export function readDraft(caseKey: string): CaseDraft | null {
  try {
    const text = storage()?.getItem(keyFor(caseKey));
    if (!text) return null;
    const draft = JSON.parse(text) as CaseDraft;
    return draft && draft.version === CASE_DRAFT_VERSION && Array.isArray(draft.changes) ? draft : null;
  } catch {
    return null; // unreadable: treat as no draft rather than block opening the case
  }
}

export function writeDraft(caseKey: string, draft: CaseDraft): void {
  try {
    storage()?.setItem(keyFor(caseKey), JSON.stringify(draft));
  } catch {
    // Full or blocked storage: the board keeps working, the draft just
    // won't survive a reload.
  }
}

export function clearDraft(caseKey: string): void {
  try {
    storage()?.removeItem(keyFor(caseKey));
  } catch {
    // nothing to do
  }
}
