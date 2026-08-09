// Write path for Gramps Connect messages -- standalone Notes (never
// attached to another object's note_list) tagged "team-note", with a
// "todo-open"/"todo-done" tag pair standing in for a done flag (see
// store/views.ts's TEAM_NOTES_VIEW doc comment for why a tag pair, not a
// column). Same generic-object-CRUD, no-backend-changes shape as
// jobsApi.ts's Media helpers -- gramps-web-api gets nothing new here
// either.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import { getOrCreateTagHandle } from "./jobsApi";
import { formatAuthoredText } from "./authoredText";

const TEAM_NOTE_TAG = "team-note";
const TODO_OPEN_TAG = "todo-open";
const TODO_DONE_TAG = "todo-done";

function addedHandle(trans: { type: string; handle: string }[]): string {
  const added = trans.find((t) => t.type === "add");
  if (!added) throw new Error("expected an 'add' transaction entry, got none");
  return added.handle;
}

/** Creates a standalone Note tagged "team-note" + "todo-open". Unlike
 * uploadMedia, Note creation has no blob-upload step -- the POST body is
 * JSON throughout, so tag_list can be set in the same request instead of a
 * follow-up GET+PUT. */
export async function createTeamNote(token: string, author: string, message: string): Promise<string> {
  const [teamTag, openTag] = await Promise.all([
    getOrCreateTagHandle(token, TEAM_NOTE_TAG),
    getOrCreateTagHandle(token, TODO_OPEN_TAG),
  ]);
  const res = await fetch(`${API_BASE}/api/notes/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text: { string: formatAuthoredText(author, message) }, tag_list: [teamTag, openTag] }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return addedHandle(await res.json());
}

/** Swaps the todo-open/todo-done tag on an existing team note. Generic
 * object PUT is a full replace (same reasoning as jobsApi.ts's
 * tagAndDescribeMedia), so this fetches the current object first. */
export async function toggleTeamNoteDone(token: string, handle: string, done: boolean): Promise<void> {
  const [addTag, removeTag] = done ? [TODO_DONE_TAG, TODO_OPEN_TAG] : [TODO_OPEN_TAG, TODO_DONE_TAG];
  const addTagHandle = await getOrCreateTagHandle(token, addTag);

  const getRes = await fetch(`${API_BASE}/api/notes/${encodeURIComponent(handle)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!getRes.ok) throw new Error(await parseErrorMessage(getRes));
  const obj = await getRes.json();

  const removeTagHandle = await getOrCreateTagHandle(token, removeTag);
  const currentTags = ((obj.tag_list as string[]) ?? []).filter((t) => t !== removeTagHandle);
  obj.tag_list = currentTags.includes(addTagHandle) ? currentTags : [...currentTags, addTagHandle];

  const putRes = await fetch(`${API_BASE}/api/notes/${encodeURIComponent(handle)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(obj),
  });
  if (!putRes.ok) throw new Error(await parseErrorMessage(putRes));
}

export async function deleteTeamNote(token: string, handle: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/notes/${encodeURIComponent(handle)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}
