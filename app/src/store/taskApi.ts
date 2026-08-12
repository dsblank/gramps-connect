// Shared polling helper for gramps-web-api's Celery task endpoints (GET
// /api/tasks/<id>) -- used by any dialog that dispatches a task and needs
// to await its own completion directly (import, delete-all, ...), as
// opposed to jobsPoll.ts's trackJob(), which is fire-and-forget with
// callbacks and specific to the report/export -> Media promotion pipeline.
import { getTaskStatus, type TaskStatus } from "./jobsApi";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const POLL_MS = 1500;
const ACTIVE_STATES = new Set(["PENDING", "STARTED", "PROGRESS"]);

/** Polls GET /api/tasks/<id> until the task leaves PENDING/STARTED/PROGRESS. */
export async function waitForTask(token: string, taskId: string): Promise<TaskStatus> {
  for (;;) {
    const status = await getTaskStatus(token, taskId);
    if (!ACTIVE_STATES.has(status.state)) return status;
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
