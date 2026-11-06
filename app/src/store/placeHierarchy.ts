// Hand-editing a place's enclosing hierarchy (Place.placeref_list) -- the
// write side of RelatedPanel's "Enclosing places" section
// (ParentPlacesSection.tsx): add, insert a level between a place and one
// of its enclosing places, remove, reorder, and set a PlaceRef's own date.
//
// Every operation is index-based rather than handle-based: Gramps allows
// the same enclosing place twice (e.g. a town in county A until 1850 and
// again from 1900, with a different county in between), so a handle alone
// doesn't say which entry is meant. Each one re-fetches the place and
// checks that the entry at `index` still points at `expectedRef` before
// writing, so a stale section (someone else edited the place meanwhile)
// fails loudly instead of changing the wrong row.
//
// Stored titles: a place whose title was still "following" its name and
// hierarchy (placeIndex.ts's placeTitleFollowsName -- blank, the bare name,
// or what the active place format builds) gets it rebuilt for the new
// hierarchy in the same PUT, the same rule typing a new name already
// follows in PlaceTitleFields.tsx. A hand-edited title is left alone.
// Places *below* the edited one keep their stored titles (the Rebuild
// button in their own editor is the fix-up path); automatic titles, when
// on, pick the change up everywhere as soon as the Places cache requeries.
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { fetchPlainObject, updateObject } from "./objectsApi";
import { isEmptyDate } from "./placeDisplay";
import { draftPlaceTitle, placeTitleFollowsName } from "./placeIndex";
import { getViewStore } from "./registry";
import { PLACE_VIEW } from "./views";

export interface RawPlaceRef {
  _class?: string;
  ref: string;
  date?: GrampsDate | null;
  [key: string]: unknown;
}

/** How far up to walk looking for a cycle -- real hierarchies are a
 * handful of levels; this only bounds a pathological (already-cyclic)
 * tree. */
const MAX_DEPTH = 64;

function refsOf(place: Record<string, unknown>): RawPlaceRef[] {
  return ((place.placeref_list as RawPlaceRef[] | undefined) ?? []).filter((r) => r && typeof r.ref === "string");
}

/** `place` with `refs` as its placeref_list, rebuilding its stored title
 * when it was still following the old hierarchy (see this file's header). */
function withRefs(place: Record<string, unknown>, refs: RawPlaceRef[]): Record<string, unknown> {
  const follows = placeTitleFollowsName(place);
  const next: Record<string, unknown> = { ...place, placeref_list: refs };
  if (follows) {
    const rebuilt = draftPlaceTitle(next);
    if (rebuilt != null) next.title = rebuilt;
  }
  return next;
}

function checkEntry(refs: RawPlaceRef[], index: number, expectedRef: string): void {
  if (refs[index]?.ref !== expectedRef) {
    throw new Error("This place's enclosing places changed since they were shown. Reload it and try again.");
  }
}

/** Whether `candidate` is `place` itself or already sits somewhere below
 * it -- making it an enclosing place of `place` would then close a loop
 * (A inside B inside A), which Gramps' own place editor also refuses. Walks
 * `candidate`'s ancestors (every enclosing place, every level, not just the
 * first), one GET per place, bounded by MAX_DEPTH. */
export async function wouldCreateCycle(token: string, placeHandle: string, candidate: string): Promise<boolean> {
  if (candidate === placeHandle) return true;
  const seen = new Set<string>([candidate]);
  let frontier = [candidate];
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const handle of frontier) {
      const place = await fetchPlainObject(token, PLACE_VIEW, handle);
      for (const ref of refsOf(place)) {
        if (ref.ref === placeHandle) return true;
        if (!seen.has(ref.ref)) {
          seen.add(ref.ref);
          next.push(ref.ref);
        }
      }
    }
    frontier = next;
  }
  return false;
}

const CYCLE_MESSAGE = "That place is this place itself, or is already inside it -- it can't also enclose it.";

function requery(): void {
  getViewStore("place").requeryDebounced();
}

/** Appends `parent` as another enclosing place of `placeHandle`. */
export async function addEnclosingPlace(token: string, placeHandle: string, parent: string): Promise<void> {
  if (await wouldCreateCycle(token, placeHandle, parent)) throw new Error(CYCLE_MESSAGE);
  const place = await fetchPlainObject(token, PLACE_VIEW, placeHandle);
  const refs = refsOf(place);
  await updateObject(token, PLACE_VIEW, placeHandle, withRefs(place, [...refs, { _class: "PlaceRef", ref: parent }]));
  requery();
}

/** Adds a level: `placeHandle`'s entry at `index` (pointing at
 * `expectedRef`, e.g. a state) is repointed at `middle` (a county), and
 * `middle` gets `expectedRef` as an enclosing place unless it already has
 * it -- so city-in-state becomes city-in-county-in-state. The entry keeps
 * its own date/notes/citations: it still says when this place sat at that
 * position in the hierarchy. `middle`'s new entry has no date. */
export async function insertEnclosingLevel(
  token: string,
  placeHandle: string,
  index: number,
  expectedRef: string,
  middle: string
): Promise<void> {
  if (await wouldCreateCycle(token, placeHandle, middle)) throw new Error(CYCLE_MESSAGE);
  // The middle place will be enclosed by expectedRef, so expectedRef must
  // not already sit below the middle one either.
  if (await wouldCreateCycle(token, middle, expectedRef)) {
    throw new Error("The enclosing place is already inside the place you picked, so it can't go between them.");
  }
  const place = await fetchPlainObject(token, PLACE_VIEW, placeHandle);
  const refs = refsOf(place);
  checkEntry(refs, index, expectedRef);

  // Middle first: if this one fails, the place itself is still untouched.
  const middlePlace = await fetchPlainObject(token, PLACE_VIEW, middle);
  const middleRefs = refsOf(middlePlace);
  if (!middleRefs.some((r) => r.ref === expectedRef)) {
    await updateObject(
      token, PLACE_VIEW, middle,
      withRefs(middlePlace, [...middleRefs, { _class: "PlaceRef", ref: expectedRef }])
    );
  }

  const nextRefs = refs.map((r, i) => (i === index ? { ...r, ref: middle } : r));
  await updateObject(token, PLACE_VIEW, placeHandle, withRefs(place, nextRefs));
  requery();
}

/** Removes the entry at `index`. The enclosing place itself isn't touched;
 * with nothing left, `placeHandle` becomes a top-level place. */
export async function removeEnclosingPlace(token: string, placeHandle: string, index: number, expectedRef: string): Promise<void> {
  const place = await fetchPlainObject(token, PLACE_VIEW, placeHandle);
  const refs = refsOf(place);
  checkEntry(refs, index, expectedRef);
  await updateObject(token, PLACE_VIEW, placeHandle, withRefs(place, refs.filter((_, i) => i !== index)));
  requery();
}

/** Swaps the entry at `index` with its neighbor (`delta` -1 = up, +1 =
 * down). Order matters: with no dates to choose between them, the first
 * enclosing place is the one titles are built from. */
export async function moveEnclosingPlace(
  token: string,
  placeHandle: string,
  index: number,
  expectedRef: string,
  delta: -1 | 1
): Promise<void> {
  const place = await fetchPlainObject(token, PLACE_VIEW, placeHandle);
  const refs = refsOf(place);
  checkEntry(refs, index, expectedRef);
  const target = index + delta;
  if (target < 0 || target >= refs.length) return;
  const next = [...refs];
  [next[index], next[target]] = [next[target], next[index]];
  await updateObject(token, PLACE_VIEW, placeHandle, withRefs(place, next));
  requery();
}

/** Sets the date range the entry at `index` applies to (null clears it). */
export async function setEnclosingPlaceDate(
  token: string,
  placeHandle: string,
  index: number,
  expectedRef: string,
  date: GrampsDate | null
): Promise<void> {
  const place = await fetchPlainObject(token, PLACE_VIEW, placeHandle);
  const refs = refsOf(place);
  checkEntry(refs, index, expectedRef);
  const next = refs.map((r, i) => {
    if (i !== index) return r;
    const copy: RawPlaceRef = { ...r };
    if (date && !isEmptyDate(date)) copy.date = date;
    else delete copy.date;
    return copy;
  });
  await updateObject(token, PLACE_VIEW, placeHandle, withRefs(place, next));
  requery();
}
