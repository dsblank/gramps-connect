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

export type ImportPostResult =
  | { kind: "task"; task: { id: string } }
  | { kind: "counts"; counts: ImportCounts }
  | { kind: "done" };

// dry_run=true returns object counts (sync) or a task resolving to them
// (async broker); dry_run=false returns 201 (sync) or a task whose
// completion means the import applied -- see importers.py's
// ImporterFileResource.post and make_task_response().
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
  if (res.status === 201) return { kind: "done" };
  return { kind: "counts", counts: await res.json() };
}

export function previewImport(token: string, ext: string, file: File): Promise<ImportPostResult> {
  return postImportFile(token, ext, file, true);
}

export function runImport(token: string, ext: string, file: File): Promise<ImportPostResult> {
  return postImportFile(token, ext, file, false);
}
