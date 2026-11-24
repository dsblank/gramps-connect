// Opening a case file (EVIDENCE_BOARD_PLAN.md, Phase 2; design doc, "Loading
// case files"). The tree is the source of truth and a case file is only a
// view of it, so opening never fails because the tree moved on: the board
// fits what it finds and says what changed.
//
// - Only the pinned records are loaded (plus any existing record an unsaved
//   loose end touches, so Save can send it with its `old`). Yarn is drawn
//   from the pinned records' own fields, both sides of every link being
//   stored on both records.
// - A pinned record changed since the case was last saved is "updated".
//   For a card marked "as of this save" (seenChange null, see caseFile.ts)
//   that means changed after the case-file Note's own change time.
// - A pinned record that's missing is "gone" for anyone who can see private
//   records (members and up), so the board can list it by its stored name.
//   For anyone who can't (guests), it might just be private, so it's only
//   counted, without its name.
// - Unsaved loose ends kept in this browser (caseDraft.ts) are re-applied.
//   One whose record changed or vanished since it was made is unticked and
//   listed for review (with anything depending on it), never re-applied
//   blindly over someone else's edit.
import { hasPermissions } from "../../auth/auth";
import { withDependents, type Change } from "./changes";
import { emptyCaseFile, readCaseFileNote, type CaseCard, type CaseFile } from "./caseFile";
import { readDraft, type CaseDraft } from "./caseDraft";
import { loadRecords, type GrampsClass, type GrampsRecord, type Records } from "./records";

/** Changes made in the same commit get the same second, give or take. */
export const SAME_SAVE_SLACK_SECONDS = 2;

export class CaseNotAvailableError extends Error {
  constructor() {
    super("This case file is gone, or you can't see it.");
    this.name = "CaseNotAvailableError";
  }
}

export interface OpenedCase {
  /** The case's key for its draft: the Note handle, or "new:<id>". */
  caseKey: string;
  /** The case-file Note as loaded (Save's `old`), or null if never saved. */
  note: GrampsRecord | null;
  file: CaseFile;
  /** Every loaded record: the pinned ones and those the loose ends touch. */
  base: Records;
  /** Unsaved loose ends from this browser, re-applied. */
  changes: Change[];
  /** Ids of loose ends unticked because their records moved on. */
  needsReview: string[];
  /** Cards whose record changed since the case was last saved. */
  updated: CaseCard[];
  /** Cards whose record is no longer in the tree. */
  gone: CaseCard[];
  /** Cards you can't see (maybe private, maybe gone): counted, not named. */
  hidden: number;
  /** The case was saved elsewhere since this browser's unsaved layout was
   * made, so the saved layout is shown instead. */
  layoutReplaced: boolean;
}

async function loadByClass(wanted: Map<string, GrampsClass>): Promise<Records> {
  const byClass = new Map<GrampsClass, string[]>();
  for (const [handle, cls] of wanted) byClass.set(cls, [...(byClass.get(cls) ?? []), handle]);
  const out: Records = {};
  for (const [cls, handles] of byClass) Object.assign(out, await loadRecords(cls, handles));
  return out;
}

function changeOf(record: GrampsRecord): number {
  return typeof record.change === "number" ? record.change : 0;
}

/** Re-applies a draft's loose ends against the records as they are now. */
function reapply(draft: CaseDraft | null, base: Records): { changes: Change[]; needsReview: string[] } {
  if (!draft) return { changes: [], needsReview: [] };
  const moved = new Set(
    Object.entries(draft.seen)
      .filter(([h, seen]) => !base[h] || changeOf(base[h]) !== seen.change)
      .map(([h]) => h),
  );
  const stale = draft.changes.filter((c) => c.touches.some((h) => moved.has(h))).map((c) => c.id);
  const review = withDependents(draft.changes, stale);
  return {
    changes: draft.changes.map((c) => (review.has(c.id) ? { ...c, off: true } : c)),
    needsReview: [...review],
  };
}

function classify(file: CaseFile, note: GrampsRecord | null, base: Records, canSeePrivate: boolean) {
  const updated: CaseCard[] = [];
  const gone: CaseCard[] = [];
  let hidden = 0;
  const noteChange = note ? changeOf(note) : 0;
  for (const card of file.cards) {
    const record = base[card.handle];
    if (!record) {
      if (canSeePrivate) gone.push(card);
      else hidden++;
      continue;
    }
    const since = card.seenChange === null ? noteChange + SAME_SAVE_SLACK_SECONDS : card.seenChange;
    if (changeOf(record) > since) updated.push(card);
  }
  return { updated, gone, hidden };
}

/** Opens the saved case file `noteHandle`. */
export async function openCase(noteHandle: string): Promise<OpenedCase> {
  const notes = await loadRecords("Note", [noteHandle]);
  const note = notes[noteHandle];
  if (!note) throw new CaseNotAvailableError();
  const saved = readCaseFileNote(note);
  const draft = readDraft(noteHandle);
  // The draft's layout counts only if it was made against this very save.
  const draftCurrent = !!draft && draft.noteChange === changeOf(note);
  const file = draftCurrent ? draft!.file : saved;
  const layoutReplaced = !!draft && !draftCurrent && JSON.stringify(draft.file) !== JSON.stringify(saved);

  const wanted = new Map<string, GrampsClass>(file.cards.map((c) => [c.handle, c.class]));
  for (const [h, seen] of Object.entries(draft?.seen ?? {})) wanted.set(h, seen.class);
  const base = await loadByClass(wanted);
  const { changes, needsReview } = reapply(draft, base);
  // Guests can't see private records; everyone from Member up can.
  const canSeePrivate = hasPermissions("ViewPrivate");
  return { caseKey: noteHandle, note, file, base, changes, needsReview, ...classify(file, note, base, canSeePrivate), layoutReplaced };
}

/** Opens a case that hasn't been saved yet: from its draft in this browser
 * if there is one, else empty. */
export async function openUnsavedCase(caseKey: string, name: string, startedBy: string): Promise<OpenedCase> {
  const draft = readDraft(caseKey);
  const file = draft?.file ?? emptyCaseFile(name, startedBy);
  const wanted = new Map<string, GrampsClass>(file.cards.map((c) => [c.handle, c.class]));
  for (const [h, seen] of Object.entries(draft?.seen ?? {})) wanted.set(h, seen.class);
  const base = await loadByClass(wanted);
  const { changes, needsReview } = reapply(draft, base);
  const canSeePrivate = hasPermissions("ViewPrivate");
  return { caseKey, note: null, file, base, changes, needsReview, ...classify(file, null, base, canSeePrivate), layoutReplaced: false };
}

/** The draft to keep for a board's current state: its layout and loose
 * ends, with the change time of every existing record those loose ends
 * touch (from the records as loaded). */
export function draftOf(opened: Pick<OpenedCase, "note" | "base">, file: CaseFile, changes: Change[]): CaseDraft {
  const seen: CaseDraft["seen"] = {};
  for (const change of changes) {
    for (const h of change.touches) {
      const record = opened.base[h];
      if (record) seen[h] = { class: record._class, change: changeOf(record) };
    }
  }
  return { version: 1, noteChange: opened.note ? changeOf(opened.note) : null, file, changes, seen };
}
