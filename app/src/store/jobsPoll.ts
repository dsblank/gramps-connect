// Job-status watcher driving report/export promotion and the completion
// toast -- see the plan's "Job-status watcher" section (§4). Modeled on
// historyPoll.ts's shape (pure helpers + a driver returning a cleanup
// function), but two independent loops instead of one: a fast,
// in-memory, dispatch-scoped loop for the tab that actually kicked a job
// off, and a slow, server-driven sweep that rescues jobs whose dispatching
// tab is gone. Neither loop persists anything to localStorage -- TaskTree
// (server-side) is already the durable record.
import { getToken } from "../auth/auth";
import { getTaskStatus, listOwnTasks } from "./jobsApi";
import { promoteJob, describeGenericJob, type JobKind, type PromoteResult } from "./jobsPromote";

const DISPATCH_POLL_MS = 2500;
const SWEEP_INTERVAL_MS = 3 * 60 * 1000;

// Celery task function names (TaskListItem.name / TaskStatus.name) that
// this pipeline cares about -- every other dispatched task (import,
// search reindex, ...) is ignored by both loops below.
const TASK_NAME_TO_KIND: Record<string, JobKind> = {
  generate_report: "report",
  export_db: "export",
  export_media: "export",
};

function resultUrl(resultObject: unknown): string | null {
  if (
    resultObject &&
    typeof resultObject === "object" &&
    typeof (resultObject as { url?: unknown }).url === "string"
  ) {
    return (resultObject as { url: string }).url;
  }
  return null;
}

export interface JobsPollCallbacks {
  onPromoted: (result: PromoteResult, kind: JobKind) => void;
  onFailed: (kind: JobKind, message: string) => void;
}

/** Fast, in-memory, dispatch-scoped tracking for a report/export *this tab*
 * just dispatched -- polls GET /api/tasks/<task_id> every ~2.5s until the
 * task leaves PENDING/STARTED, then promotes it (jobsPromote.ts) and fires
 * the completion toast. `optionsSummary`, if given, becomes the new
 * Media's desc verbatim -- the dispatching tab is the only place
 * subject-specific detail (who/what the report was about) is ever
 * available, since `options` is never persisted server-side; see the
 * plan's §1 step 4. Falls back to the same generic label the catch-up
 * sweep below would derive when omitted.
 *
 * Nothing here is persisted: a reload before this settles simply drops
 * this call's own tracking, and the catch-up sweep picks the job up later
 * instead (that's the point of it) -- so this function is fire-and-forget
 * from the caller's perspective, no cleanup handle to hold onto. */
export function trackJob(taskId: string, kind: JobKind, callbacks: JobsPollCallbacks, optionsSummary?: string): void {
  async function poll() {
    let token: string;
    try {
      token = await getToken();
    } catch (err: any) {
      callbacks.onFailed(kind, err.message ?? String(err));
      return;
    }
    try {
      const status = await getTaskStatus(token, taskId);
      if (status.state === "PENDING" || status.state === "STARTED") {
        setTimeout(poll, DISPATCH_POLL_MS);
        return;
      }
      if (status.state !== "SUCCESS") {
        callbacks.onFailed(kind, status.state);
        return;
      }
      const url = resultUrl(status.result_object);
      if (!url) {
        callbacks.onFailed(kind, "job succeeded but returned no file");
        return;
      }
      const desc = optionsSummary ?? (await describeGenericJob(token, kind, url));
      const result = await promoteJob(token, kind, url, desc);
      // A null result means the file was already claimed -- e.g. the
      // catch-up sweep won the race -- which already toasted (or will).
      if (result) callbacks.onPromoted(result, kind);
    } catch (err: any) {
      console.error(`job ${taskId} tracking failed`, err);
      callbacks.onFailed(kind, err.message ?? String(err));
    }
  }
  poll();
}

async function sweepOnce(callbacks: JobsPollCallbacks): Promise<void> {
  const token = await getToken();
  const tasks = await listOwnTasks(token);
  for (const task of tasks) {
    const kind = TASK_NAME_TO_KIND[task.name];
    if (!kind || task.state !== "SUCCESS") continue;
    const status = await getTaskStatus(token, task.task_id);
    const url = resultUrl(status.result_object);
    if (!url) continue;
    const desc = await describeGenericJob(token, kind, url);
    // Idempotent via the processed-file endpoint's delete-on-read: an
    // already-promoted job (by this tab's own trackJob(), or a previous
    // sweep tick, or another tab entirely) 404s here and promoteJob()
    // returns null -- no dedup bookkeeping needed to avoid double-
    // promoting or racing another sweep. A FAILURE state is deliberately
    // never toasted from here: the dispatching tab (or an earlier sweep)
    // already saw it fail, and a *different* session's sweep re-surfacing
    // a stranger's old failure serves no one.
    const result = await promoteJob(token, kind, url, desc);
    if (result) callbacks.onPromoted(result, kind);
  }
}

/** Starts the slow, server-driven catch-up sweep (plan §4): on mount and
 * every few minutes thereafter, lists this user's own tasks
 * (`GET /api/tasks/?include_state=true`, filtered server-side to the
 * caller's own tree) and promotes any SUCCESS'd report/export not yet
 * claimed. Rescues jobs whose dispatching tab closed before trackJob()
 * above could promote them, including from a different browser/device --
 * bounded by Celery's result_expires (see get_task_result_cutoff(),
 * defaults 24h), past which the job is lost to this mechanism (accepted,
 * see the plan's "Closed-tab recovery" decision). Returns a cleanup
 * function that stops the sweep. */
export function startCatchupSweep(callbacks: JobsPollCallbacks): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick() {
    if (stopped) return;
    try {
      await sweepOnce(callbacks);
    } catch (err) {
      console.error("job catch-up sweep failed", err);
    } finally {
      if (!stopped) timer = setTimeout(tick, SWEEP_INTERVAL_MS);
    }
  }
  tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
