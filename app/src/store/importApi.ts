// Thin wrapper around gramps-web-api's importer endpoint
// (POST /api/importers/<ext>/file) -- import_file runs as the same kind of
// Celery task as generate_report/export_db (see jobsApi.ts/jobsPoll.ts),
// just outside the report/export -> Media promotion pipeline those two go
// through, so it polls via taskApi.ts's shared waitForTask() instead of
// reusing trackJob()'s fire-and-forget, promotion-shaped flow.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";

// Matches gramps-web's GrampsjsImport.js supported-extension list minus
// .gpkg (Gramps package), which gramps-web-api's importer can't handle
// without bundled media and is called out there as unsupported, plus
// "jsonl" -- the JSON addon (~/gramps/addons-source/JSON), a plain
// per-line dump/load with no gramps_id merge logic, so it's really only
// suited to an empty tree (a duplicate-object risk otherwise) but is the
// fastest of the bunch for that case.
export const IMPORT_EXTENSIONS = ["gramps", "ged", "gw", "def", "vcf", "csv", "jsonl"] as const;

export type ImportCounts = Record<string, number>;

/** What an import (or its dry run) reports back: the object counts plus,
 * since gramps-web-api v3.23.0 (#995), the importer's diagnostic messages --
 * for GEDCOM 5.x, one message listing every line it couldn't parse. Other
 * importers (GEDCOM 7 included) generally emit none. Older servers send
 * no `messages` at all, which just reads as an empty report here. */
export interface ImportResult {
  counts: ImportCounts;
  messages: string[];
}

export type ImportPostResult =
  | { kind: "task"; task: { id: string } }
  | { kind: "result"; result: ImportResult };

/** Splits ImportResultSchema's flat {people: n, ..., messages: [...]} shape
 * (the sync 200/201 body and the async task's result_object alike) into
 * counts and messages. Tolerates a missing/empty body -- pre-v3.23.0
 * servers answered a real sync import with a bare 201. */
export function parseImportResult(raw: unknown): ImportResult {
  const counts: ImportCounts = {};
  const messages: string[] = [];
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key === "messages") {
        if (Array.isArray(value)) {
          for (const m of value) if (typeof m === "string" && m.trim()) messages.push(m);
        }
      } else if (typeof value === "number") {
        counts[key] = value;
      }
    }
  }
  return { counts, messages };
}

/** Joins an import report's messages for display. The GEDCOM importer pads
 * each problem with spaces to a fixed column and then appends the source
 * line ("Line   144: 1 FILE ..."); moving that onto its own indented line
 * keeps the report narrow. Same regex as gramps-web's
 * GrampsjsImportExportReport.js (#1483). */
export function formatImportMessages(messages: string[]): string {
  return messages.join("\n").replace(/[ \t]{2,}(?=Line +\d+:)/g, "\n    ");
}

// dry_run=true returns 200 (sync) or a task; dry_run=false returns 201
// (sync) or a task whose completion means the import applied -- see
// importers.py's ImporterFileResource.post and make_task_response(). Either
// way the body/task result is an ImportResultSchema.
async function postImportFile(
  token: string,
  ext: string,
  file: File,
  dryRun: boolean
): Promise<ImportPostResult> {
  const res = await fetch(
    `${API_BASE}/api/importers/${encodeURIComponent(ext)}/file?dry_run=${dryRun}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: file,
    }
  );
  if (res.status === 202) {
    const body = await res.json();
    return { kind: "task", task: body.task };
  }
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // an old server's bare 201 -- nothing to report
  }
  return { kind: "result", result: parseImportResult(body) };
}

export function previewImport(token: string, ext: string, file: File): Promise<ImportPostResult> {
  return postImportFile(token, ext, file, true);
}

export function runImport(token: string, ext: string, file: File): Promise<ImportPostResult> {
  return postImportFile(token, ext, file, false);
}
