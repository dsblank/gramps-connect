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
