// Thin wrapper around gramps-web-api's media archive endpoint
// (POST /api/media/archive/) -- the write side of mediaImportApi.ts's
// upload. Same two-shape response exportersApi.ts's runExport() handles: a
// task to poll when a Celery broker is configured, or the finished
// archive's own `url` when run_task() ran it inline.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";

export type RunMediaExportResult =
  | { kind: "task"; taskId: string }
  | { kind: "done"; url: string };

/** POST /api/media/archive/ -- zips every Media file the caller may see
 * (the server applies its own private-record filter, same as a tree
 * export) and hands back either a task to poll or, once run inline, the
 * finished archive's download `url` directly. */
export async function runMediaExport(token: string): Promise<RunMediaExportResult> {
  const res = await fetch(`${API_BASE}/api/media/archive/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const body = await res.json();
  if (res.status === 202) return { kind: "task", taskId: body.task.id };
  return { kind: "done", url: body.url };
}
