// Generic attach/detach for any object's own ref-list field (note_list,
// citation_list, tag_list -- plain handle arrays -- or media_list, whose
// entries wrap the handle in a MediaRef) -- the write side of RelatedPanel's
// Notes/Citations/Tags/Media sections. Same GET-then-PUT-full-object shape
// as jobsApi.ts's tagAndDescribeMedia and notesApi.ts's own toggleMessageDone,
// generalized across list fields via objectsApi.ts's fetchPlainObject/
// updateObject instead of each caller inlining its own fetch calls.
import { fetchPlainObject, updateObject } from "./objectsApi";
import type { ViewConfig } from "./views";

export type RefListEntry = string | { _class: string; ref: string };

function entryHandle(entry: RefListEntry): string {
  return typeof entry === "string" ? entry : entry.ref;
}

/** Appends `entry` to `objectHandle`'s `listField` (e.g. "citation_list").
 * `entry` is a bare handle for note_list/citation_list/tag_list, or a
 * `{_class: "MediaRef", ref: <handle>}` struct for media_list. */
export async function attachRefListEntry(
  token: string,
  view: ViewConfig,
  objectHandle: string,
  listField: string,
  entry: RefListEntry
): Promise<void> {
  const obj = await fetchPlainObject(token, view, objectHandle);
  const list = ((obj[listField] as RefListEntry[] | undefined) ?? []) as RefListEntry[];
  obj[listField] = [...list, entry];
  await updateObject(token, view, objectHandle, obj);
}

/** Removes whichever entry of `objectHandle`'s `listField` points at
 * `targetHandle` (comparing bare handles or a wrapped ref's `.ref`). */
export async function detachRefListEntry(
  token: string,
  view: ViewConfig,
  objectHandle: string,
  listField: string,
  targetHandle: string
): Promise<void> {
  const obj = await fetchPlainObject(token, view, objectHandle);
  const list = ((obj[listField] as RefListEntry[] | undefined) ?? []) as RefListEntry[];
  obj[listField] = list.filter((entry) => entryHandle(entry) !== targetHandle);
  await updateObject(token, view, objectHandle, obj);
}
