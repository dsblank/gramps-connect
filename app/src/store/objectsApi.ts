// Write path for the stacked create-dialog flow (see PersonEditDialog.tsx,
// FamilyEditDialog.tsx, draftStack.ts): a single atomic multi-object create,
// POST /api/objects/ (gramps-web-api's CreateObjectsResource). Unlike a
// single-object POST, this commits every object in the array inside one
// DbTxn -- including wiring up Family<->Person back-references -- so a new
// Family and its brand-new parents can be saved together with no
// orphaned-Person-on-cancel risk. Requires the array to list a referenced
// Person before any Family that points at it (CreateObjectsResource adds
// objects to the db in array order, and a Family's back-ref wiring looks its
// parents up by handle at that point in the transaction).
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import { endpointBaseFor } from "./objectDetail";
import type { ViewConfig } from "./views";

export interface TransactionEntry {
  type: "add" | "update" | "delete";
  handle: string;
  _class: string;
}

/** A handle in the same shape gramps' own create_id() produces
 * (gramps/gen/utils/id.py: `"%08x%08x" % (...)`, 32 lowercase hex chars) --
 * generated client-side so a not-yet-saved object can be referenced by
 * handle from another draft before either exists on the server. */
export function createHandle(): string {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return bytes[0].toString(16).padStart(8, "0") + bytes[1].toString(16).padStart(8, "0");
}

/** POSTs every object dict in `objects` in one request, one DbTxn. Each dict
 * needs at least `_class` and `handle` (see createHandle()); other fields
 * are optional -- gramps-web-api fills in the rest of that class's defaults
 * (complete_gramps_object_dict) before validating. */
export async function createObjects(
  token: string,
  objects: Record<string, unknown>[]
): Promise<TransactionEntry[]> {
  const res = await fetch(`${API_BASE}/api/objects/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(objects),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return await res.json();
}

/** Plain GET of an object's editable-dict shape -- no `extend`/`profile`/
 * `backlinks` params, unlike `objectDetail.ts`'s `fetchObjectExtended`
 * (that one is fattened for display, with extra `extended`/`profile` keys
 * a PUT shouldn't send back). Same bare-GET shape `notesApi.ts`'s
 * `attachNoteToObject`/`toggleMessageDone` already inline before their own
 * PUT; factored out here since it's now needed in more than one place
 * (draftStack.ts's openEditDraft, PersonEditDialog's own birth/death Event
 * fetch). */
export async function fetchPlainObject(
  token: string,
  view: ViewConfig,
  handle: string
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}${endpointBaseFor(view)}${encodeURIComponent(handle)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return await res.json();
}

/** Repairs the one known way a fetched object fails gramps-web-api's own
 * schema check on the way back in: an LDS ordinance (Person or Family
 * `lds_ord_list`) whose `place` is null. Gramps core writes that null
 * itself -- Person/Family._remove_handle_references set `ordinance.place =
 * None` when the place it pointed at is deleted (gramps/gen/lib/person.py,
 * family.py) -- yet LdsOrd's schema types `place` as a plain string, so an
 * unchanged GET->PUT of such a record 400s ("$.lds_ord_list[0].place: None
 * is not of type 'string'"). "" is Gramps' own "no place" (PlaceBase's
 * default, what the XML importer writes), so this loses nothing; the other
 * fields that code nulls (Family father/mother_handle, LdsOrd.famc) are
 * schema-nullable and left alone. Returns `data` itself when there's
 * nothing to repair, else a copy -- callers like draftStack.ts keep the
 * fetched dict around to diff against. */
export function repairForSave(data: Record<string, unknown>): Record<string, unknown> {
  const ords = data.lds_ord_list;
  if (!Array.isArray(ords) || !ords.some((o) => o && typeof o === "object" && o.place === null)) {
    return data;
  }
  return {
    ...data,
    lds_ord_list: ords.map((o) => (o && typeof o === "object" && o.place === null ? { ...o, place: "" } : o)),
  };
}

/** PUTs a full object dict back -- gramps-web-api's generic object PUT is a
 * full replace, not a partial patch (same reasoning as jobsApi.ts's
 * tagAndDescribeMedia and notesApi.ts's toggleMessageDone), so callers must
 * have started from fetchPlainObject's result and mutated it in place.
 * Passes through repairForSave() first. */
export async function updateObject(
  token: string,
  view: ViewConfig,
  handle: string,
  data: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${API_BASE}${endpointBaseFor(view)}${encodeURIComponent(handle)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(repairForSave(data)),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}

/** DELETEs a single object. Server-side (delete.py's per-type
 * delete_person/delete_event/delete_citation/...) this also strips the
 * deleted handle out of every *other* object that referenced it -- but
 * never cascades the other way (deleting a Citation doesn't touch its
 * Source even if now unreferenced). No client-side orphan cleanup is
 * attempted here; see DeleteButton.tsx's doc comment. */
export async function deleteObject(token: string, view: ViewConfig, handle: string): Promise<void> {
  const res = await fetch(`${API_BASE}${endpointBaseFor(view)}${encodeURIComponent(handle)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}
