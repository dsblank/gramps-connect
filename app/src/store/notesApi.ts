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
import { endpointBaseFor } from "./objectDetail";
import type { ViewConfig } from "./views";

export const TEAM_NOTE_TAG = "team-note";
const TODO_OPEN_TAG = "todo-open";
export const TODO_DONE_TAG = "todo-done";

const tagHandleCache = new Map<string, Promise<string>>();

/** Memoized wrapper around getOrCreateTagHandle -- each tag name looked up
 * (or created) once and cached for the rest of the session rather than once
 * per caller. NotesSection needs this on every object with attached notes:
 * telling a message apart from an ordinary note, and a done message from an
 * open one, both come down to comparing a nested note's raw tag_list
 * against one of these known tags' handles (extend=all doesn't resolve tag
 * names on a note nested inside another object's note_list -- only the
 * top-level fetched object's own forward refs get that). Reset on failure
 * so a transient error doesn't wedge every future call for that name. */
export function getTagHandleCached(token: string, name: string): Promise<string> {
  let promise = tagHandleCache.get(name);
  if (!promise) {
    promise = getOrCreateTagHandle(token, name).catch((err) => {
      tagHandleCache.delete(name);
      throw err;
    });
    tagHandleCache.set(name, promise);
  }
  return promise;
}

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

/** Appends `noteHandle` to an arbitrary object's `note_list` -- the
 * structural way a Note "references" another object in Gramps' own data
 * model (NotesSection.tsx already renders whatever's in note_list for every
 * type that has one). Same GET-then-PUT-full-object shape as
 * jobsApi.ts's tagAndDescribeMedia (Media's tag_list) and this file's own
 * toggleTeamNoteDone (a Note's tag_list), generalized to any object type
 * via `view.endpoint` instead of a hardcoded `/api/media/`. */
export async function attachNoteToObject(
  token: string,
  view: ViewConfig,
  objectHandle: string,
  noteHandle: string
): Promise<void> {
  const base = endpointBaseFor(view);
  const getRes = await fetch(`${API_BASE}${base}${encodeURIComponent(objectHandle)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!getRes.ok) throw new Error(await parseErrorMessage(getRes));
  const obj = await getRes.json();
  obj.note_list = [...((obj.note_list as string[]) ?? []), noteHandle];
  const putRes = await fetch(`${API_BASE}${base}${encodeURIComponent(objectHandle)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(obj),
  });
  if (!putRes.ok) throw new Error(await parseErrorMessage(putRes));
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
