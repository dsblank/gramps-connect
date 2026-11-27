// Case files: one Evidence Board each, saved in the tree as a Note of the
// custom type "Case File" whose text is JSON (EVIDENCE_BOARD_PLAN.md,
// Phase 2). Free-standing JSON with its own type is a Note by the project's
// storage rule (like Topics); the list view finds case files by that type.
//
// A case file holds the board, not the research: which records are pinned
// up and where, their card sizes, and the sticky notes. The records
// themselves stay in the tree, so a case file never goes stale: on opening,
// the board loads the pinned records as they are now (caseLoad.ts) and
// points out what changed since.
//
// "Changed since you last looked" needs to know each record's change time
// when the case was last saved. A record this Save itself changes only gets
// its new change time from the server's commit -- too late to write into
// the same transaction. Its card says `seenChange: null` instead: "as of
// this case file's own save". The case-file Note is written in that same
// commit, so its own `change` time is the one to compare against, both
// from the server's clock.
import { createHandle } from "../objectsApi";
import { sameValue } from "./changes";
import { blank, grampsType, isType, type GrampsClass, type GrampsRecord } from "./records";

export const CASE_FILE_NOTE_TYPE = "Case File";
export const CASE_FILE_VERSION = 1;

export type CardSize = "icon" | "compact" | "expanded";

export interface CaseCard {
  handle: string;
  class: GrampsClass;
  /** As of the last save, for showing a card whose record is gone. */
  gramps_id: string;
  /** Short name as of the last save (same reason). */
  label: string;
  /** The record's `change` time when the case was last saved; null when
   * that save changed the record itself (see the file comment). */
  seenChange: number | null;
  x: number;
  y: number;
  size: CardSize;
}

export interface CaseSticky {
  id: string;
  text: string;
  x: number;
  y: number;
  /** The cards (record handles) this note is about, drawn as pencil lines
   * from the note to each. Board only, like the note itself. Missing in
   * case files and drafts from before notes could be linked. */
  about?: string[];
}

export interface CaseFile {
  version: typeof CASE_FILE_VERSION;
  name: string;
  /** What the case is trying to find out, e.g. "Who were Ruth Carter's parents?". */
  question: string;
  description: string;
  /** Who started the case (their display name), set once. Notes don't
   * record their creator, and the list view shouldn't dig through History. */
  startedBy: string;
  cards: CaseCard[];
  stickies: CaseSticky[];
}

export class CaseFileFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseFileFormatError";
  }
}

export function emptyCaseFile(name: string, startedBy: string): CaseFile {
  return { version: CASE_FILE_VERSION, name, question: "", description: "", startedBy, cards: [], stickies: [] };
}

/** Is `note` a case file (by its note type)? */
export function isCaseFileNote(note: GrampsRecord): boolean {
  const type = note.type as { string?: string } | undefined;
  return note._class === "Note" && isType(type, "NoteType", "CUSTOM") && type?.string === CASE_FILE_NOTE_TYPE;
}

export function serializeCaseFile(file: CaseFile): string {
  return JSON.stringify(file);
}

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const SIZES: CardSize[] = ["icon", "compact", "expanded"];
const CLASSES: GrampsClass[] = ["Person", "Family", "Event", "Place", "Source", "Citation", "Repository", "Media", "Note"];

/** Reads a case file's JSON text. Tolerant: unknown fields are ignored and
 * missing ones get defaults, so a case file written by a newer or older
 * version still opens; cards that make no sense are dropped. Throws
 * CaseFileFormatError if the text isn't a case file at all. */
export function parseCaseFile(text: string): CaseFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CaseFileFormatError("This case file's text isn't valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CaseFileFormatError("This case file's text isn't a case file");
  const data = raw as Record<string, unknown>;
  const version = num(data.version, 0);
  if (version < 1) throw new CaseFileFormatError("This case file has no format version");
  // Version 1 is the only one so far; upgrades from older versions go here.
  const cards: CaseCard[] = [];
  for (const c of Array.isArray(data.cards) ? data.cards : []) {
    if (!c || typeof c !== "object") continue;
    const card = c as Record<string, unknown>;
    const cls = card.class as GrampsClass;
    if (typeof card.handle !== "string" || !card.handle || !CLASSES.includes(cls)) continue;
    cards.push({
      handle: card.handle,
      class: cls,
      gramps_id: str(card.gramps_id),
      label: str(card.label),
      seenChange: card.seenChange === null ? null : num(card.seenChange),
      x: num(card.x),
      y: num(card.y),
      size: SIZES.includes(card.size as CardSize) ? (card.size as CardSize) : "compact",
    });
  }
  const stickies: CaseSticky[] = [];
  for (const s of Array.isArray(data.stickies) ? data.stickies : []) {
    if (!s || typeof s !== "object") continue;
    const sticky = s as Record<string, unknown>;
    const about = Array.isArray(sticky.about) ? sticky.about.filter((h): h is string => typeof h === "string" && !!h) : [];
    stickies.push({ id: str(sticky.id) || createHandle(), text: str(sticky.text), x: num(sticky.x), y: num(sticky.y), ...(about.length ? { about: [...new Set(about)] } : {}) });
  }
  return {
    version: CASE_FILE_VERSION,
    name: str(data.name, "Untitled case"),
    question: str(data.question),
    description: str(data.description),
    startedBy: str(data.startedBy),
    cards,
    stickies,
  };
}

/** The case file's text, read from its Note. */
export function readCaseFileNote(note: GrampsRecord): CaseFile {
  if (!isCaseFileNote(note)) throw new CaseFileFormatError("This note isn't a case file");
  return parseCaseFile(str((note.text as { string?: unknown } | undefined)?.string));
}

/** A new case-file Note (no Gramps ID yet: Save assigns it). */
export function newCaseFileNote(isPrivate = false): GrampsRecord {
  return blank<GrampsRecord>("Note", {
    handle: createHandle(),
    gramps_id: "",
    private: isPrivate,
    type: grampsType("NoteType", "CUSTOM", CASE_FILE_NOTE_TYPE),
    text: blank("StyledText", { string: "" }),
  });
}

/** `note` with `file` written into it, as Save sends it: new records' cards
 * get the Gramps IDs Save just picked, and cards for records this Save
 * changes get `seenChange: null` (see the file comment). */
export function writeCaseFileNote(
  note: GrampsRecord,
  file: CaseFile,
  save: { newIds: Record<string, string>; savedHandles: Set<string> },
  isPrivate?: boolean,
): GrampsRecord {
  const content: CaseFile = {
    ...file,
    cards: file.cards.map((card) => ({
      ...card,
      gramps_id: save.newIds[card.handle] ?? card.gramps_id,
      seenChange: save.savedHandles.has(card.handle) ? null : card.seenChange,
    })),
  };
  const text = { ...(note.text as Record<string, unknown>), string: serializeCaseFile(content) };
  return { ...note, text, ...(isPrivate === undefined ? {} : { private: isPrivate }) };
}

/** Does writing `file` into `note` change anything? (A Save with nothing
 * new on the board needn't touch the case file.) */
export function caseFileChanged(before: GrampsRecord, after: GrampsRecord): boolean {
  return !sameValue(before, after);
}
