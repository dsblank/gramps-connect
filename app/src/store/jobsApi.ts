// Thin wrappers around gramps-web-api's existing, unmodified REST surface
// for the report/export -> Media promotion pipeline (store/jobsPromote.ts)
// and the job-status watcher (store/jobsPoll.ts). Nothing here is a new
// backend endpoint -- see the plan's "What stays completely untouched in
// gramps-web-api" section.
import { API_BASE } from "../config";
import { parseErrorMessage, fetchPage } from "./api";
import { fetchPlainObject, updateObject } from "./objectsApi";
import { MEDIA_VIEW, TAG_VIEW } from "./views";

export type TaskState = "PENDING" | "STARTED" | "SUCCESS" | "FAILURE" | string;

export interface TaskStatus {
  state: TaskState;
  result_object: unknown;
  info?: string;
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
  // Strip any "; charset=..." (or other) parameters: gramps-web-api's own
  // report-download endpoint sets its Content-Type from the stdlib
  // mimetypes module rather than its MIME_TYPES const, so text-based
  // report outputs (.txt, .html, ...) come back as e.g.
  // "text/plain; charset=utf-8". Relaying that verbatim to
  // uploadMedia()/POST /api/media/ makes the server's get_extension() fail
  // to match it and raise "MIME type not recognized" (500).
  const rawContentType = res.headers.get("Content-Type") ?? "application/octet-stream";
  const contentType = rawContentType.split(";")[0].trim();
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

/** PUT /api/media/<handle>/file (file.py:MediaFileResource.put) -- replaces
 * an *existing* media object's file content in place, under the same
 * handle: the server recomputes checksum/path/mime itself, same as
 * uploadMedia's POST does for a new one. Used by MapItemEditorDialog.tsx's
 * edit flow so a re-saved KML file keeps the handle every Place's
 * media_list and MediaMapButton's link already point at, rather than
 * minting a new Media object and having to rewire every reference to it.
 * No `If-Match` sent -- the endpoint treats a missing one as "don't check",
 * and this editor has no concurrent-edit story to enforce yet.
 *
 * A 409 (the endpoint's own reply to bytes identical to what's already
 * stored -- "don't allow PUTting if the file didn't change") is treated as
 * success here, not an error: from this function's point of view, the
 * server already has the content being asked for, so there's nothing left
 * to do. Surfacing it as a failure would block MapItemEditorDialog.tsx's
 * Save whenever someone edits only the description/place and leaves the
 * shapes themselves untouched -- found live. */
export async function updateMediaFile(token: string, handle: string, blob: Blob, mimeType: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/media/${encodeURIComponent(handle)}/file`, {
    method: "PUT",
    headers: { "Content-Type": mimeType, Authorization: `Bearer ${token}` },
    body: blob,
  });
  if (res.status === 409) return;
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}

/** Sets an existing Media object's `desc` -- fetch-then-PUT-whole-object,
 * same shape as tagAndDescribeMedia above, but standing alone (no tag/
 * filename side effects) for MapItemEditorDialog.tsx's plain "Description"
 * field, on both a freshly-uploaded map item and an edit of an existing
 * one. */
export async function setMediaDesc(token: string, handle: string, desc: string): Promise<void> {
  const obj = await fetchPlainObject(token, MEDIA_VIEW, handle);
  obj.desc = desc;
  await updateObject(token, MEDIA_VIEW, handle, obj);
}

function addedHandle(trans: { type: string; handle: string }[]): string {
  const added = trans.find((t) => t.type === "add");
  if (!added) throw new Error("expected an 'add' transaction entry, got none");
  return added.handle;
}

/** uploadMedia() plus a best-effort `desc` of the file's own name -- shared
 * by every "drop/pick a file to create a Media object" entry point
 * (RefPickerField.tsx's MediaListField, useMediaDrop.ts's global drop
 * handler) so the description-setting isn't duplicated per call site.
 * Not fatal if the desc PUT fails; the Media object itself is already
 * created either way. */
export async function uploadMediaFile(token: string, file: File): Promise<string> {
  const handle = await uploadMedia(token, file, file.type || "application/octet-stream");
  try {
    const obj = await fetchPlainObject(token, MEDIA_VIEW, handle);
    obj.desc = file.name;
    await updateObject(token, MEDIA_VIEW, handle, obj);
  } catch {
    // best-effort, see above
  }
  return handle;
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

/** Attribute holding the name a generated file should download as. Needed
 * because the server derives the download name from the Media object's
 * `path`, which it builds itself as `<checksum><ext>` with `ext` guessed
 * from the upload's MIME type (media.py's get_default_filename) -- so a
 * format with no registered MIME (.jsonl, .gw, .wft) becomes
 * `<checksum>.bin`, and every generated file, even the ones that guess
 * right, downloads under its checksum. `path` itself can't be corrected
 * from here: local storage *resolves the file* through it (file.py's
 * LocalFileHandler), so rewriting it would point at nothing.
 *
 * A plain custom attribute type, which the API takes as a bare string and
 * reconstructs server-side as AttributeType(CUSTOM, "File name"). Named to
 * read properly, since the Output detail panel shows attributes as-is. */
export const FILE_NAME_ATTRIBUTE = "File name";

/** Sets `desc`, appends `tagHandle` to `tag_list`, and (when given) records
 * `fileName` as the FILE_NAME_ATTRIBUTE attribute, on an existing Media
 * object. Generic object PUT is a full replace (base.py's _parse_object/
 * update_object take a whole object, not a partial patch), so this fetches
 * the current object first rather than sending just the changed fields. */
export async function tagAndDescribeMedia(
  token: string,
  handle: string,
  desc: string,
  tagHandle: string,
  fileName?: string
): Promise<void> {
  const getRes = await fetch(`${API_BASE}/api/media/${encodeURIComponent(handle)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!getRes.ok) throw new Error(await parseErrorMessage(getRes));
  const obj = await getRes.json();
  obj.desc = desc;
  obj.tag_list = [...(((obj.tag_list as string[]) ?? [])), tagHandle];
  if (fileName) {
    obj.attribute_list = [
      ...((obj.attribute_list as unknown[]) ?? []),
      { _class: "Attribute", type: FILE_NAME_ATTRIBUTE, value: fileName },
    ];
  }
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
