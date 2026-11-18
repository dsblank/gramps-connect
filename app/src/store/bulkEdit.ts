// The selection pane's bulk Tag and Privacy changes: gramps-web-api's
// POST /objects/edit-by-handle/ (3.26+) applies the same operations to
// every selected record in one transaction -- one entry in the history, so
// one Undo -- and commits only the records that actually change.
import { getToken } from "../auth/auth";
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import { apiFetch } from "./apiFetch";
import { namespaceFor } from "./mergeApi";
import { describeTaskFailure, taskProgress, waitForTask } from "./taskApi";
import type { ViewConfig } from "./views";

export type EditOperation =
  | { op: "add_tag" | "remove_tag"; handle: string }
  | { op: "set_private"; value: boolean };

/** Past this many records an edit runs as a background task, with
 * progress, so a large one can't run into a proxy timeout. Still one
 * transaction. */
export const BULK_EDIT_BACKGROUND_FROM = 500;

export interface BulkEditProgress {
  /** Records gone through so far, once the task reports it. */
  done: number | null;
  total: number;
}

/** Whether a view's records can be tagged and made private. A Tag can't
 * carry a tag or be private itself. */
export function supportsBulkEdit(view: ViewConfig): boolean {
  return view.key !== "tag";
}

/** Applies `operations` to every one of `handles`. Resolves to how many
 * records changed (records already as asked are left alone), or null when
 * a background task doesn't say. */
export async function editSelected(
  view: ViewConfig,
  handles: string[],
  operations: EditOperation[],
  onProgress?: (progress: BulkEditProgress) => void,
): Promise<number | null> {
  const total = handles.length;
  const background = total > BULK_EDIT_BACKGROUND_FROM;
  onProgress?.({ done: null, total });
  const res = await apiFetch(
    `${API_BASE}/api/objects/edit-by-handle/${background ? "?background=true" : ""}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await getToken()}` },
      body: JSON.stringify({ namespace: namespaceFor(view), handles, operations }),
    },
    background ? { lane: "long" } : undefined,
  );
  if (res.status === 202) {
    const { task } = (await res.json()) as { task: { id: string } };
    const status = await waitForTask(task.id, (running) => {
      const progress = taskProgress(running);
      if (progress) onProgress?.({ done: progress.current, total });
    });
    if (status.state !== "SUCCESS") throw new Error(describeTaskFailure(status));
    return Array.isArray(status.result_object) ? status.result_object.length : null;
  }
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  // The transaction: one entry per record that changed.
  const changed = (await res.json().catch(() => null)) as unknown;
  return Array.isArray(changed) ? changed.length : null;
}
