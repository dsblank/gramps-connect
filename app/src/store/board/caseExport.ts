// "Download" on the Evidence Board: the case file as one JSON file, to keep
// or share outside the tree. It holds the case (name, question, notes, the
// board's layout) and a copy of every pinned record as it is in the tree,
// in Gramps' own form, so the file still makes sense without the tree.
// Unsaved loose ends aren't mixed in: they're listed by name, so nothing in
// the file claims to be in the tree when it isn't.
import { clickDownloadLink } from "../downloadFile";
import type { CaseFile } from "./caseFile";
import type { Records } from "./records";

export const CASE_EXPORT_FORMAT = "gramps-connect-case-file";

export interface CaseExport {
  format: typeof CASE_EXPORT_FORMAT;
  version: 1;
  exported: string;
  case: CaseFile;
  /** Pinned records as saved in the tree, by handle. */
  records: Records;
  /** Loose ends not saved yet, in plain words. */
  unsaved: string[];
}

export function caseExport(file: CaseFile, saved: Records, unsaved: string[], now = new Date()): CaseExport {
  const records: Records = {};
  for (const c of file.cards) if (saved[c.handle]) records[c.handle] = saved[c.handle];
  // Cards for records not in the tree yet aren't part of the saved case.
  const cards = file.cards.filter((c) => saved[c.handle]);
  return { format: CASE_EXPORT_FORMAT, version: 1, exported: now.toISOString(), case: { ...file, cards }, records, unsaved };
}

/** A file name from the case's name: "Ruth Carter's parents.case.json". */
export function caseExportFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${clean || "Case file"}.case.json`;
}

export function downloadCase(file: CaseFile, saved: Records, unsaved: string[]): void {
  const json = JSON.stringify(caseExport(file, saved, unsaved), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  clickDownloadLink(url, caseExportFileName(file.name));
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
