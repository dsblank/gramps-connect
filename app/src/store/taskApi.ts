// Shared polling helper for gramps-web-api's Celery task endpoints (GET
// /api/tasks/<id>) -- used by any dialog that dispatches a task and needs
// to await its own completion directly (import, delete-all, ...), as
// opposed to jobsPoll.ts's trackJob(), which is fire-and-forget with
// callbacks and specific to the report/export -> Media promotion pipeline.
import { getToken } from "../auth/auth";
import { getTaskStatus, type TaskStatus } from "./jobsApi";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const POLL_MS = 1500;
/** Task states meaning "not finished yet". PROGRESS is a running task that
 * has reported progress (e.g. export_db's "Exporting..."), not a failure. */
export const ACTIVE_STATES: ReadonlySet<string> = new Set(["PENDING", "STARTED", "PROGRESS"]);

/** Polls GET /api/tasks/<id> until the task leaves PENDING/STARTED/PROGRESS.
 * Long-running tasks (imports especially) can easily outlive a 15-minute
 * access token, so this re-derives the token from getToken() on every poll
 * rather than reusing the caller's snapshot -- getToken() itself only
 * refreshes when the cached token is expiring soon, so this doesn't add a
 * refresh call to every poll's happy path. `onStatus` sees every
 * still-running status, e.g. to show a PROGRESS task's
 * taskProgress(). */
export async function waitForTask(taskId: string, onStatus?: (status: TaskStatus) => void): Promise<TaskStatus> {
  for (;;) {
    const token = await getToken();
    const status = await getTaskStatus(token, taskId);
    if (!ACTIVE_STATES.has(status.state)) return status;
    onStatus?.(status);
    await sleep(POLL_MS);
  }
}

/** Extracts a human-readable message from a failed task's status --
 * TaskResource wraps a raised TaskError as {"error": "..."} in
 * result_object (see tasks.py's _task_error_payload); anything else falls
 * back to the `info` string. */
export function describeTaskFailure(status: Pick<TaskStatus, "info" | "result_object">): string {
  const obj = status.result_object;
  if (obj && typeof obj === "object" && "error" in obj && typeof (obj as any).error === "string") {
    return (obj as any).error;
  }
  return status.info || "Task failed";
}

/** A running task's `{current, total}` -- what gramps-web-api's
 * progress_callback_count() puts in result_object while the state is
 * PROGRESS -- or null when it hasn't reported any yet. */
export function taskProgress(status: Pick<TaskStatus, "result_object">): { current: number; total: number } | null {
  const obj = status.result_object as { current?: unknown; total?: unknown } | null;
  if (!obj || typeof obj !== "object") return null;
  const { current, total } = obj;
  if (typeof current !== "number" || typeof total !== "number" || total <= 0) return null;
  return { current, total };
}
