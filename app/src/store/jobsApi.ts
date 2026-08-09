// Thin wrappers around gramps-web-api's existing, unmodified REST surface
// for the report/export -> Media promotion pipeline (store/jobsPromote.ts)
// and the job-status watcher (store/jobsPoll.ts). Nothing here is a new
// backend endpoint -- see the plan's "What stays completely untouched in
// gramps-web-api" section.
import { API_BASE } from "../config";
import { parseErrorMessage, fetchPage } from "./api";
import { TAG_VIEW } from "./views";

export type TaskState = "PENDING" | "STARTED" | "SUCCESS" | "FAILURE" | string;

export interface TaskStatus {
  state: TaskState;
  result_object: unknown;
  task_id?: string;
  name?: string;
  created_at?: string;
  user_id?: string;
  user_name?: string;
}

/** GET /api/tasks/<task_id> -- polled by jobsPoll.ts's fast, dispatch-scoped
 * loop until the task leaves PENDING/STARTED. */
export async function getTaskStatus(token: string, taskId: string): Promise<TaskStatus> {
  const res = await fetch(`${API_BASE}/api/tasks/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

export interface TaskListItem {
  task_id: string;
  name: string;
  created_at: string;
  user_id?: string | null;
  user_name?: string | null;
  state?: TaskState | null;
}

/** GET /api/tasks/?include_state=true, no other args -- server-side scoped
 * to the caller's own tasks for the current tree (TaskTree.user_id ==
 * caller, unless they hold PERM_VIEW_OTHER_USER). Polled by jobsPoll.ts's
 * slow catch-up sweep to discover jobs whose dispatching tab is gone. */
export async function listOwnTasks(token: string): Promise<TaskListItem[]> {
  const res = await fetch(`${API_BASE}/api/tasks/?include_state=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return res.json();
}

/** Downloads a finished report/export's processed file
 * (`.../file/processed/<uuid>.<ext>`, from the task result's own `url`) --
 * delete-on-read server-side, so this can succeed at most once across every
 * tab/session racing to promote the same job. Returns null on 404 (already
 * claimed by an earlier poll tick, or another tab of the same user) rather
 * than throwing: that's the expected, harmless outcome of the race, not an
 * error -- see jobsPromote.ts. */
export async function downloadProcessedFile(
  token: string,
  url: string
): Promise<{ blob: Blob; contentType: string } | null> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const contentType = res.headers.get("Content-Type") ?? "application/octet-stream";
  return { blob: await res.blob(), contentType };
}

/** POST /api/media/ (media.py:77) -- generic upload; the server reads the
 * mime type straight off the request's own Content-Type header (not a JSON
 * field), computes the checksum/path, and creates the Media object. The
 * response is a transaction (one "add" entry) rather than the object
 * itself -- same shape POST returns for any object type. */
export async function uploadMedia(token: string, blob: Blob, mimeType: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/media/`, {
    method: "POST",
    headers: { "Content-Type": mimeType, Authorization: `Bearer ${token}` },
    body: blob,
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return addedHandle(await res.json());
}

function addedHandle(trans: { type: string; handle: string }[]): string {
  const added = trans.find((t) => t.type === "add");
  if (!added) throw new Error("expected an 'add' transaction entry, got none");
  return added.handle;
}

/** Finds an existing Tag by exact name (reusing TAG_VIEW's own query
 * config/endpoint, same object-query POST every other view already uses),
 * or creates one via the generic object POST if none exists. */
export async function getOrCreateTagHandle(token: string, name: string): Promise<string> {
  const { page } = await fetchPage(TAG_VIEW, token, null, false, `name == ${JSON.stringify(name)}`, TAG_VIEW.orderBy, 1);
  if (page.items.length > 0) return page.items[0].handle;

  const res = await fetch(`${API_BASE}/api/tags/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return addedHandle(await res.json());
}

/** Sets `desc` and appends `tagHandle` to `tag_list` on an existing Media
 * object. Generic object PUT is a full replace (base.py's _parse_object/
 * update_object take a whole object, not a partial patch), so this fetches
 * the current object first rather than sending just the two changed
 * fields. */
export async function tagAndDescribeMedia(token: string, handle: string, desc: string, tagHandle: string): Promise<void> {
  const getRes = await fetch(`${API_BASE}/api/media/${encodeURIComponent(handle)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!getRes.ok) throw new Error(await parseErrorMessage(getRes));
  const obj = await getRes.json();
  obj.desc = desc;
  obj.tag_list = [...(((obj.tag_list as string[]) ?? [])), tagHandle];
  const putRes = await fetch(`${API_BASE}/api/media/${encodeURIComponent(handle)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(obj),
  });
  if (!putRes.ok) throw new Error(await parseErrorMessage(putRes));
}

/** DELETE /api/media/{handle} -- per the plan's known limitation, this only
 * removes the DB record, not the underlying stored file (true for all
 * Media today, not something the Output view's "Delete the export?" flow
 * introduces). */
export async function deleteMedia(token: string, handle: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/media/${encodeURIComponent(handle)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}
