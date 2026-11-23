// Fire-and-forget starters for the two export jobs, shared by
// ExportDialog.tsx, MenuBar.tsx's Export -> Media… and MakeBackupDialog.tsx.
// Each returns at once; the toasts from jobsCallbacks.ts report how the run
// went.
import { getToken } from "../auth/auth";
import { exportQueryParams, initialToggleValues, DEFAULT_LIVING, DEFAULT_YEARS_AFTER_DEATH, runExport } from "./exportersApi";
import { runMediaExport } from "./mediaExportApi";
import { deliverJob, trackJob } from "./jobsPoll";
import { downloadArchiveLocally, exportLabel, stripMnemonic } from "./jobsPromote";
import { jobsPollCallbacks, notifyJobStarted } from "./jobsCallbacks";

/** Starts a tree export in `extension`'s format (`name` is the exporter's
 * display name, mnemonic and all). The request isn't awaited, for the
 * reasons ReportDialog.handleGenerate gives: with a Celery broker the POST
 * returns a task id at once and trackJob() does the waiting; without one,
 * run_task() runs the export inline and the POST doesn't return until the
 * file exists. Either way the result is promoted to an "export"-tagged
 * Media object (or downloaded, for a user who can't add records). */
export function startTreeExport(
  extension: string,
  name: string,
  params: Record<string, string>,
  desc: string = exportLabel(name)
): void {
  notifyJobStarted("export", stripMnemonic(name));

  (async () => {
    const token = await getToken();
    const result = await runExport(token, extension, params);
    if (result.kind === "task") {
      // trackJob() polls, promotes and toasts on its own, and is
      // deliberately not awaited (see its doc comment).
      trackJob(result.taskId, "export", jobsPollCallbacks, desc);
      return;
    }
    // Ran inline, so the finished file is already there -- same delivery,
    // just with no task to watch first.
    await deliverJob(token, "export", result.url, desc, result.messages, jobsPollCallbacks);
  })().catch((err: any) => {
    jobsPollCallbacks.onFailed("export", err.message ?? String(err));
  });
}

/** Everything in the tree, as a compressed Gramps XML file: the one format
 * Restore from Backup reads. Private records and living people are kept,
 * whatever the Export dialog was last set to. */
export function startBackupExport(): void {
  const params = exportQueryParams("gramps", {
    toggles: { ...initialToggleValues(), private: false, reference: false, compress: true },
    living: DEFAULT_LIVING,
    yearsAfterDeath: DEFAULT_YEARS_AFTER_DEATH,
  });
  const stamp = new Date().toISOString().slice(0, 10);
  startTreeExport("gramps", "Backup", params, `Backup (Gramps XML) — ${stamp}`);
}

/** Export -> Media…: one archive of every Media file the caller may see.
 * Never promoted into the tree as Media, unlike every other job kind -- see
 * jobsPromote.ts's downloadArchiveLocally doc comment on why a copy of the
 * tree's whole media collection has no business being stored *in* the tree
 * a second time -- it goes straight to the user's disk. */
export function startMediaExport(): void {
  const desc = exportLabel("Media");
  notifyJobStarted("export", "Media");

  (async () => {
    const token = await getToken();
    const result = await runMediaExport(token);
    if (result.kind === "task") {
      trackJob(result.taskId, "export", jobsPollCallbacks, desc);
      return;
    }
    if (await downloadArchiveLocally(token, result.url, desc)) jobsPollCallbacks.onDownloaded(desc, "export", []);
  })().catch((err: any) => {
    jobsPollCallbacks.onFailed("export", err.message ?? String(err));
  });
}
