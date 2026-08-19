// Generic attach/detach for any object's own ref-list field (note_list,
// citation_list, tag_list -- plain handle arrays -- or media_list, whose
// entries wrap the handle in a MediaRef) -- the write side of RelatedPanel's
// Notes/Citations/Tags/Media sections. Same GET-then-PUT-full-object shape
// as jobsApi.ts's tagAndDescribeMedia and notesApi.ts's own toggleMessageDone,
// generalized across list fields via objectsApi.ts's fetchPlainObject/
// updateObject instead of each caller inlining its own fetch calls.
import { fetchPlainObject, updateObject } from "./objectsApi";
import type { ViewConfig } from "./views";

// The extra index signature (rather than plain `{_class: string; ref:
// string}`) lets a caller pass a ref struct with its own metadata fields
// too -- e.g. a ChildRef's frel/mrel, an EventRef's role, or a MediaRef's
// call_number -- without a cast (attach itself never needs to read them,
// just pass them through verbatim). Every metadata-carrying ref type now
// attaches through its own edit dialog's nested-draft mechanism instead of
// this live-attach path (RefPickerField.tsx's RefListField/EventsField/
// AssociationsField), so no current caller actually exercises this beyond
// a plain handle or a bare MediaRef -- kept general rather than narrowed,
// since AttachControl.tsx (still alive for media/generated) could still
// need it for a future metadata-carrying type.
export type RefListEntry = string | ({ _class: string; ref: string } & Record<string, unknown>);

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

/** Merges `fieldPatch` onto whichever entry of `objectHandle`'s `listField`
 * points at `targetHandle` -- e.g. changing a ChildRef's frel/mrel or an
 * EventRef's role, as opposed to attach/detach's whole-entry add/remove.
 * `listField`'s entries must already be ref structs (not bare handles --
 * unlike attach/detach, there's no per-field metadata to patch on a plain
 * handle), so this is only ever called for child_ref_list/event_ref_list/
 * person_ref_list/reporef_list, never note_list/citation_list/tag_list. */
export async function patchRefListEntry(
  token: string,
  view: ViewConfig,
  objectHandle: string,
  listField: string,
  targetHandle: string,
  fieldPatch: Record<string, unknown>
): Promise<void> {
  const obj = await fetchPlainObject(token, view, objectHandle);
  const list = ((obj[listField] as Record<string, unknown>[] | undefined) ?? []) as Record<string, unknown>[];
  obj[listField] = list.map((entry) =>
    entry.ref === targetHandle ? { ...entry, ...fieldPatch } : entry
  );
  await updateObject(token, view, objectHandle, obj);
}

/** Sets a *singular* ref field (Family's father_handle/mother_handle,
 * Event's place, Citation's source_handle) to `value` -- attach/detach's
 * list-splice counterpart for a field that holds one handle, not an array.
 * `value` is "" to clear it, gramps-web-api's own convention for an unset
 * singular ref (confirmed against a live event with `place: ""` --
 * PlaceSection.tsx's doc comment). */
export async function setRefField(
  token: string,
  view: ViewConfig,
  objectHandle: string,
  field: string,
  value: string
): Promise<void> {
  const obj = await fetchPlainObject(token, view, objectHandle);
  obj[field] = value;
  await updateObject(token, view, objectHandle, obj);
}
