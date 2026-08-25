// Read/write for the tree's default (home) person -- gramps-web-api's
// /api/metadata/default-person/ (a thin wrapper around Gramps'
// db.get_default_handle()/set_default_person_handle(), same "home person"
// concept Gramps desktop's Edit > Set Home Person uses), not a per-browser
// preference: it's tree-wide and every client/device sees the same one.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";

/** GET's the default person's handle, or null if the tree has none set. */
export async function fetchDefaultPersonHandle(token: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/metadata/default-person/`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const data = await res.json();
  return (data.handle as string | null) ?? null;
}

/** PUTs a new default person (or null to clear it). Requires the EditTree
 * permission (owner role) server-side -- HomePersonPanel only renders the
 * "set" control once hasPermissions("EditTree") is true, same convention
 * AttachControl.tsx's EditObject gate uses. */
export async function setDefaultPersonHandle(token: string, handle: string | null): Promise<void> {
  const res = await fetch(`${API_BASE}/api/metadata/default-person/`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ handle }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}
