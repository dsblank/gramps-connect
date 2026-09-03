// Wraps gramps-web-api's merge and bulk-delete endpoints -- neither was
// previously called from this app (see objectsApi.ts for the single-object
// mutation conventions this follows: endpointBaseFor + parseErrorMessage).
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import { endpointBaseFor } from "./objectDetail";
import type { ViewConfig } from "./views";

/** The view.key values gramps-web-api actually has a merge route for
 * (resources/merge.py + api/__init__.py:272-398) -- excludes the app's
 * virtual/filtered views (generated, messages, story -- subtypes of
 * media/note with no merge route of their own) and tags (no MergeTagResource
 * exists; Gramps has never supported merging tags). */
export const MERGE_SUPPORTED_VIEWS = [
  "person", "family", "event", "place", "repository", "source", "citation", "media", "note",
];

/** POST /api/<plural-type>/<phoenix>/merge/<titanic> -- gramps-web-api's
 * merge endpoint (resources/merge.py), one route per mergeable type
 * (person/family/event/place/repository/source/citation/media/note; tags
 * aren't mergeable, no route exists for them). `phoenixHandle` survives,
 * edited with the merged data; `titanicHandle` is deleted. No request body
 * needed for the simple types -- Person/Family accept optional secondary
 * knobs (family_merger, phoenix_father_handle/phoenix_mother_handle) this
 * first pass doesn't expose, same scope gramps-web's own merge UI keeps to. */
export async function mergeObjects(
  token: string,
  view: ViewConfig,
  phoenixHandle: string,
  titanicHandle: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE}${endpointBaseFor(view)}${encodeURIComponent(phoenixHandle)}/merge/${encodeURIComponent(titanicHandle)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: "{}",
    }
  );
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}

/** The plural REST namespace segment gramps-web-api's bulk-delete endpoint
 * expects (e.g. "people", not "person") -- derived from the view's own
 * endpoint rather than view.key, which is singular. */
export function namespaceFor(view: ViewConfig): string {
  return endpointBaseFor(view).replace(/^\/api\//, "").replace(/\/$/, "");
}

/** POST /api/objects/delete-by-handle/ -- deletes every handle in one
 * request/transaction, unlike looping objectsApi.ts's single deleteObject. */
export async function deleteObjectsBulk(token: string, view: ViewConfig, handles: string[]): Promise<void> {
  const res = await fetch(`${API_BASE}/api/objects/delete-by-handle/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ namespace: namespaceFor(view), handles }),
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
}
