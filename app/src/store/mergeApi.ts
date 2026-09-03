// Wraps gramps-web-api's merge and bulk-delete endpoints -- neither was
// previously called from this app (see objectsApi.ts for the single-object
// mutation conventions this follows: endpointBaseFor + parseErrorMessage).
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import { endpointBaseFor, fetchObjectExtended, getBacklinks } from "./objectDetail";
import { fetchPlainObject, updateObject, deleteObject } from "./objectsApi";
import { VIEWS, TAG_VIEW } from "./views";
import type { ViewConfig } from "./views";

/** The view.key values gramps-web-api actually has a merge route for
 * (resources/merge.py + api/__init__.py:272-398) -- excludes the app's
 * virtual/filtered views (generated, messages, story -- subtypes of
 * media/note with no merge route of their own) and tags (no MergeTagResource
 * exists; Gramps has never supported merging tags server-side -- see
 * mergeTags() below for how this app offers it anyway). */
export const MERGE_SUPPORTED_VIEWS = [
  "person", "family", "event", "place", "repository", "source", "citation", "media", "note",
];

/** True for every view.key MergeButton.tsx offers a Merge action for --
 * MERGE_SUPPORTED_VIEWS (a real REST merge route) plus "tag" (this app's own
 * client-orchestrated mergeTags(), no server route needed). */
export function isMergeable(viewKey: string): boolean {
  return MERGE_SUPPORTED_VIEWS.includes(viewKey) || viewKey === "tag";
}

/** What MergeDialog.tsx tells the user up front about *this* type's merge --
 * deliberately per-type, not one generic sentence: every mergeable type in
 * Gramps only unions its list-shaped fields (notes/citations/attributes/
 * media/tags); its own defining content always comes from whichever record
 * survives, the other's is discarded outright, and *which* fields that
 * covers varies a lot by type (confirmed against each type's own merge()
 * docstring in gramps/gen/lib/*.py). Most consequential for Note, whose
 * entire *text* is discarded if you don't pick it -- nothing else even
 * comes close (an Event losing its date, or a Source losing its title, is
 * awkward; a Note silently losing its actual wording is a real content-loss
 * trap, hence its own, more pointed copy below). */
const MERGE_MESSAGES: Record<string, string> = {
  person: "Choose the person whose name will be used. Every other detail is combined either way, and every other reference to the one you don't pick is automatically repointed here first.",
  family: "Choose the family whose relationship type will be used. Everything else is combined either way, and every other reference to the one you don't pick is automatically repointed here first.",
  event: "Choose the event whose type, date, place, and description will be used -- the other's own versions of these are discarded, not combined. Notes, citations, media, and attributes are combined either way.",
  place: "Choose the place whose title will be used. Locations, alternate names, notes, citations, and media are combined either way.",
  repository: "Choose the repository whose name and type will be used -- the other's are discarded, not combined. Notes and addresses are combined either way.",
  source: "Choose the source whose title, author, and publication info will be used -- the other's are discarded, not combined. Notes, media, attributes, and repository links are combined either way.",
  citation: "Choose the citation whose page and date will be used -- the other's are discarded, not combined. Notes, media, and attributes are combined either way.",
  media: "Choose the media object whose file and date will be used -- the other's are discarded, not combined. Notes, citations, and attributes are combined either way.",
  note: "Choose the note whose text will be used -- the other's wording is permanently discarded, not combined. Only privacy and tags carry over from the one you don't pick.",
  tag: "Choose the tag to keep. Every object tagged with the other one is retagged with this one, then the other tag is deleted -- nothing is combined, since a tag has no content of its own beyond its name and color.",
};

export function mergeMessageFor(viewKey: string): string {
  return (
    MERGE_MESSAGES[viewKey] ??
    "Choose the object whose data will take priority if there is a conflict. Every other reference to the one you don't pick is automatically repointed here first."
  );
}

/** POST /api/<plural-type>/<phoenix>/merge/<titanic> -- gramps-web-api's
 * merge endpoint (resources/merge.py), one route per mergeable type
 * (person/family/event/place/repository/source/citation/media/note; tags
 * aren't mergeable, no route exists for them). `phoenixHandle` survives,
 * edited with the merged data; `titanicHandle` is deleted.
 *
 * `args` is the optional per-type body gramps_webapi's own schemas define --
 * every type except Person/Family ignores any body at all. Person takes
 * `family_merger` (bool, defaults true server-side if omitted -- not
 * exposed by this app yet). Family takes `phoenix_father_handle`/
 * `phoenix_mother_handle`: when the two families being merged have
 * different fathers (or mothers), the survivor's own is kept by default --
 * these let the caller pick the *other* family's parent instead, which is
 * otherwise silently discarded (Family.merge()'s own docstring: "Lost: ...
 * father, mother of acquisition"). MergeDialog.tsx is the one caller that
 * populates this, only for Family, only once it's detected the two
 * families actually differ on a parent. */
export async function mergeObjects(
  token: string,
  view: ViewConfig,
  phoenixHandle: string,
  titanicHandle: string,
  args?: Record<string, unknown>
): Promise<void> {
  const res = await fetch(
    `${API_BASE}${endpointBaseFor(view)}${encodeURIComponent(phoenixHandle)}/merge/${encodeURIComponent(titanicHandle)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(args ?? {}),
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

const VIEW_BY_KEY = new Map(VIEWS.map((v) => [v.key, v]));

/** Gramps has no MergeTagQuery and gramps-web-api has no merge route for
 * Tags (a Tag is just a name/color/priority label, not a PrimaryObject with
 * its own merge semantics) -- so unlike every other mergeable type, this is
 * entirely client-orchestrated, one PATCH per object that referenced the
 * losing tag rather than a single atomic server-side transaction. Mirrors
 * what MergePersonQuery/MergeFamilyQuery/etc. do server-side via
 * find_backlink_handles + replace_handle_reference, just re-implemented
 * here against the REST API's own backlinks (fetchObjectExtended's
 * `backlinks=1`, already used by BacklinksSection.tsx) and tag_list
 * (refListApi.ts's own attach/detach convention, inlined here since this
 * touches every backlinked object rather than one).
 *
 * Not atomic -- if a PATCH partway through fails, whatever was already
 * repointed stays repointed and the error propagates (same "no rollback,
 * surface the error" tradeoff as DeleteButton/BulkDeleteButton elsewhere in
 * this app). `titanicHandle` is only deleted once every backlink has been
 * repointed successfully. */
export async function mergeTags(token: string, phoenixHandle: string, titanicHandle: string): Promise<void> {
  const detail = await fetchObjectExtended(token, TAG_VIEW, titanicHandle);
  const backlinks = getBacklinks(detail);
  for (const [type, items] of Object.entries(backlinks)) {
    const view = VIEW_BY_KEY.get(type);
    if (!view) continue; // a backlink type this app doesn't know a ViewConfig for -- shouldn't happen for a real object type, skip defensively rather than fail the whole merge
    await Promise.all(
      (items as { handle: string }[]).map(async ({ handle }) => {
        const obj = await fetchPlainObject(token, view, handle);
        const tagList = ((obj.tag_list as string[] | undefined) ?? []).filter((h) => h !== titanicHandle);
        if (!tagList.includes(phoenixHandle)) tagList.push(phoenixHandle);
        obj.tag_list = tagList;
        await updateObject(token, view, handle, obj);
      })
    );
  }
  await deleteObject(token, TAG_VIEW, titanicHandle);
}
