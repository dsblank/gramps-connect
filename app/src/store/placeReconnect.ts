// Client-side fixup for a gap gramps-web-api's own delete leaves behind:
// delete.py's delete_place strips the deleted place from every Person/
// Family/Event that referenced it directly, but never looks at *other
// Places* -- a child place's own placeref_list pointing at the one being
// deleted is left completely untouched, now a dangling reference to a
// handle that no longer exists (confirmed by reading delete_place itself;
// see the conversation this was written from). Gramps desktop's own Check
// and Repair tool eventually notices and points it at a synthetic
// "Unknown" place instead -- it doesn't reconnect the hierarchy either.
// Call this BEFORE the actual delete request(s) so the gap never appears
// in the first place, the same "don't create the gap" preference as
// WikidataPlaceLookupDialog.tsx's "Skip this level" checkbox.
import { API_BASE } from "../config";
import { PAGE_SIZE, parseErrorMessage } from "./api";
import { apiFetch } from "./apiFetch";
import { fetchPlainObject, updateObject } from "./objectsApi";
import { PLACE_VIEW } from "./views";

interface RawPlaceRef {
  _class?: string;
  ref?: string;
}

/** Handles per `where_expr` -- a Ctrl/Cmd+A of thousands of places is
 * looked up a chunk at a time rather than as one enormous expression. */
const HANDLE_CHUNK = 200;

/** Repoints every place directly enclosed by one of `deletedHandles` at
 * the nearest surviving ancestor instead -- walking past however many
 * consecutive deleted places sit above it (e.g. deleting a place and its
 * own parent together in one bulk action). A place whose entire lineage
 * up to the root is being deleted just loses that PlaceRef, becoming a
 * new root -- the same outcome an ordinary single-level deletion (with no
 * parent to reconnect to) already has today. A PlaceRef to something
 * *outside* `deletedHandles` is always left alone.
 *
 * Scales to any selection: both lookups below are /query/ calls in chunks
 * of HANDLE_CHUNK handles, each paged to the end, rather than one GET per
 * deleted place and a single first page of children (which silently
 * skipped every enclosed place past the first 1000). */
export async function reconnectPlaceChildren(token: string, deletedHandles: string[]): Promise<void> {
  const deletedSet = new Set(deletedHandles);
  if (deletedSet.size === 0) return;
  const chunks: string[][] = [];
  const all = [...deletedSet];
  for (let i = 0; i < all.length; i += HANDLE_CHUNK) chunks.push(all.slice(i, i + HANDLE_CHUNK));
  // Handles are server-generated alphanumeric ids with no quote/escape
  // characters -- splicing them into a where_expr string is already relied
  // on elsewhere (api.ts's fetchByHandle).
  const listOf = (chunk: string[]) => `[${chunk.map((h) => `'${h}'`).join(", ")}]`;

  // Each deleted place's own recorded parent (if any), fetched fresh here
  // rather than trusting a caller-supplied ObjectDetail -- needed to know
  // what a child should repoint *to*, not just what to remove.
  const ownParent = new Map<string, string | null>();
  for (const chunk of chunks) {
    for (const place of await queryPlaceRefs(token, `handle in ${listOf(chunk)}`)) {
      ownParent.set(place.handle, place.placeref_list[0]?.ref ?? null);
    }
  }

  // Memoized so a multi-level deleted branch isn't re-walked once per
  // child found below it.
  const survivorCache = new Map<string, string | null>();
  function survivingAncestor(handle: string): string | null {
    if (survivorCache.has(handle)) return survivorCache.get(handle) ?? null;
    const parent = ownParent.get(handle) ?? null;
    const result = parent == null ? null : deletedSet.has(parent) ? survivingAncestor(parent) : parent;
    survivorCache.set(handle, result);
    return result;
  }

  // `enclosing_places` is gramps-object-query-language's own registered
  // name for placeref_list (see gramps-object-query-language/docs/
  // where_expr.md's "One-to-many relationships" table) -- a real EXISTS
  // subquery against actual PlaceRef.ref values, not the urls-field
  // like()-on-JSON-text trick WikidataPlaceLookupDialog.tsx's dedup query
  // needs (placeref_list has no such workaround available: it's a list of
  // objects, not a single embedded one). A child enclosed by places in two
  // chunks turns up twice; the Set keeps it to one update.
  const children = new Set<string>();
  for (const chunk of chunks) {
    for (const child of await queryPlaceRefs(token, `any(p.handle in ${listOf(chunk)} for p in enclosing_places)`)) {
      if (!deletedSet.has(child.handle)) children.add(child.handle); // being deleted itself, not left behind
    }
  }

  for (const childHandle of children) {
    const existing = await fetchPlainObject(token, PLACE_VIEW, childHandle);
    const refs = (existing.placeref_list as RawPlaceRef[] | undefined) ?? [];
    let changed = false;
    const rawNext: RawPlaceRef[] = [];
    for (const ref of refs) {
      if (ref.ref && deletedSet.has(ref.ref)) {
        changed = true;
        const replacement = survivingAncestor(ref.ref);
        if (replacement) rawNext.push({ _class: "PlaceRef", ref: replacement });
        continue;
      }
      rawNext.push(ref);
    }
    if (!changed) continue;
    // Two different removed refs can resolve to the same surviving
    // ancestor (or that ancestor was already directly referenced) --
    // dedup by ref rather than trying to avoid the collision above.
    const seen = new Set<string>();
    const nextRefs = rawNext.filter((r) => {
      if (!r.ref || seen.has(r.ref)) return false;
      seen.add(r.ref);
      return true;
    });
    await updateObject(token, PLACE_VIEW, childHandle, { ...existing, placeref_list: nextRefs });
  }
}

/** Every place matching `whereExpr`, with its raw placeref_list -- one
 * /query/ (PLACE_VIEW's own endpoint), paged to the end. Not api.ts's
 * fetchPage(), whose `select` is built from a view's display columns;
 * placeref_list isn't one. */
async function queryPlaceRefs(
  token: string,
  whereExpr: string
): Promise<{ handle: string; placeref_list: RawPlaceRef[] }[]> {
  const found: { handle: string; placeref_list: RawPlaceRef[] }[] = [];
  let after: string | null = null;
  do {
    const res = await apiFetch(`${API_BASE}${PLACE_VIEW.endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        select: ["handle", "placeref_list"],
        where_expr: whereExpr,
        order_by: [{ column: "handle", direction: "asc" }],
        limit: PAGE_SIZE,
        after: after ?? undefined,
      }),
    });
    if (!res.ok) throw new Error(await parseErrorMessage(res));
    const page: { items: { handle: string; placeref_list?: RawPlaceRef[] | null }[]; next_after: string | null } = await res.json();
    for (const item of page.items) found.push({ handle: item.handle, placeref_list: item.placeref_list ?? [] });
    after = page.next_after;
  } while (after !== null);
  return found;
}
