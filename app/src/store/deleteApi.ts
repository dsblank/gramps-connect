// Thin wrapper around gramps-web-api's batch-delete endpoint
// (POST /api/objects/delete/) -- see resources/objects.py's
// DeleteObjectsResource / resources/delete.py's delete_all_objects. Matches
// gramps-web's own "Delete all objects" admin screen (GrampsjsDeleteAll.js).
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";

// ObjectCountsSchema's fixed field set (gramps-web-api's schemas.py) --
// also what DeleteObjectsQueryArgs' `namespaces` validates against.
export const DELETE_NAMESPACES = [
  "people",
  "families",
  "events",
  "places",
  "sources",
  "citations",
  "repositories",
  "notes",
  "media",
  "tags",
] as const;

export type DeleteNamespace = (typeof DELETE_NAMESPACES)[number];

export type DeletePostResult = { kind: "task"; task: { id: string } } | { kind: "done" };

/** Thrown when the server rejects the request for lacking a *fresh* JWT
 * (fresh_jwt_required, see auth.ts's isTokenFresh()) -- distinct from a
 * generic failure so callers can route it into a re-login prompt instead
 * of just showing an error. */
export class FreshTokenRequiredError extends Error {
  constructor() {
    super("A fresh login is required for this action.");
    this.name = "FreshTokenRequiredError";
  }
}

/** Deletes every object of the given namespaces from the current tree.
 * Passing every known namespace omits the query param entirely rather than
 * spelling all ten out -- delete_all_objects() takes a faster batch path
 * (skips undo-log recording/signals) specifically when `namespaces` is
 * `None`, i.e. an unqualified "delete everything". */
export async function deleteAllObjects(
  token: string,
  namespaces: DeleteNamespace[]
): Promise<DeletePostResult> {
  const isEverything = namespaces.length >= DELETE_NAMESPACES.length;
  const query = isEverything ? "" : `?namespaces=${namespaces.join(",")}`;
  const res = await fetch(`${API_BASE}/api/objects/delete/${query}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    throw new FreshTokenRequiredError();
  }
  if (res.status === 202) {
    const body = await res.json();
    return { kind: "task", task: body.task };
  }
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return { kind: "done" };
}
