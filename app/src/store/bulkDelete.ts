// The selection pane's bulk Delete, at any selection size -- picks the
// request by size and server (see deleteSelected()), so BulkDeleteButton.tsx
// only has to confirm, ask for a password when needed, and show progress.
import { getToken } from "../auth/auth";
import { fetchServerState } from "./cacheMeta";
import { deleteObjectsBulk, deleteObjectsBulkBackground } from "./mergeApi";
import { reconnectPlaceChildren } from "./placeReconnect";
import { supportsBackgroundDelete } from "./serverCapabilities";
import { describeTaskFailure, taskProgress, waitForTask } from "./taskApi";
import type { ViewConfig } from "./views";

/** Past this many records, a bulk delete is "large": BulkDeleteButton asks
 * for the password first (a fresh login, as Tools -> Delete items... does),
 * and deleteSelected() stops sending one synchronous request -- a
 * background task on v3.25.0+, chunks of this size before that. The
 * password check is a guard against a mistaken Ctrl/Cmd+A, not a
 * permission: delete-by-handle itself only needs DeleteObject. */
export const BULK_DELETE_THRESHOLD = 500;

export interface BulkDeleteProgress {
  /** "places": reattaching enclosed places before the delete (Places
   * only); "deleting": the delete itself. */
  phase: "places" | "deleting";
  /** Records deleted so far, when known -- the task's own count, or whole
   * chunks on an older server. */
  done: number | null;
  total: number;
}

/** A delete that stopped partway -- only possible on a server older than
 * v3.25.0, where a large delete is several requests (one transaction
 * each): `deleted` records are already gone. */
export class PartialDeleteError extends Error {
  constructor(message: string, readonly deleted: number) {
    super(message);
    this.name = "PartialDeleteError";
  }
}

/** Deletes `handles` from `view`'s type:
 * - up to BULK_DELETE_THRESHOLD: one synchronous request, as always;
 * - larger, gramps-web-api v3.25.0+: one background task (one
 *   transaction), with the task's own progress;
 * - larger, older server: synchronous requests of BULK_DELETE_THRESHOLD
 *   each, one transaction per chunk, throwing PartialDeleteError if one
 *   fails after others succeeded.
 * Places get their enclosed places reattached to a surviving parent first
 * (see placeReconnect.ts), whatever the size. */
export async function deleteSelected(
  view: ViewConfig,
  handles: string[],
  onProgress?: (progress: BulkDeleteProgress) => void
): Promise<void> {
  const total = handles.length;
  if (view.key === "place") {
    onProgress?.({ phase: "places", done: null, total });
    // Every selected handle at once, so a place and its own parent being
    // deleted together reattach past both (see reconnectPlaceChildren).
    await reconnectPlaceChildren(await getToken(), handles);
  }
  onProgress?.({ phase: "deleting", done: null, total });

  if (total <= BULK_DELETE_THRESHOLD) {
    await deleteObjectsBulk(await getToken(), view, handles);
    return;
  }

  if (await backgroundDeleteSupported()) {
    const result = await deleteObjectsBulkBackground(await getToken(), view, handles);
    if (result.kind === "task") {
      const status = await waitForTask(result.task.id, (running) => {
        const progress = taskProgress(running);
        if (progress) onProgress?.({ phase: "deleting", done: progress.current, total });
      });
      if (status.state !== "SUCCESS") throw new Error(describeTaskFailure(status));
    }
    return;
  }

  let deleted = 0;
  for (let start = 0; start < total; start += BULK_DELETE_THRESHOLD) {
    const chunk = handles.slice(start, start + BULK_DELETE_THRESHOLD);
    try {
      await deleteObjectsBulk(await getToken(), view, chunk);
    } catch (err: any) {
      if (deleted === 0) throw err;
      throw new PartialDeleteError(err?.message ?? String(err), deleted);
    }
    deleted += chunk.length;
    onProgress?.({ phase: "deleting", done: deleted, total });
  }
}

/** Whether this server takes `?background=true` -- from the memoized
 * /api/metadata/ every view already fetched. Can't tell (metadata failed)
 * counts as no: the chunked path works on every version. */
async function backgroundDeleteSupported(): Promise<boolean> {
  try {
    return supportsBackgroundDelete((await fetchServerState()).webApiVersion);
  } catch {
    return false;
  }
}
