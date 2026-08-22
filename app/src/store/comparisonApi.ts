// Media has no native Media-to-Media reference (gramps/gen/lib/media.py has
// no Association/MediaRef-style forward link at all, unlike Person's own
// PersonRef) -- this piggybacks on the generic Attribute mechanism every
// primary object already carries (Media.attribute_list) instead, using a
// custom-typed Attribute ({type: "Comparison", value: <handle>}) to link two
// Media objects for RelatedPanel's Comparisons section (ComparisonsSection.tsx).
// Written reciprocally on both sides (attach/detach each touch two objects,
// one PUT apiece) so the comparison shows up in either photo's own panel,
// not just the one it was added from.
import { fetchPlainObject, updateObject } from "./objectsApi";
import { MEDIA_VIEW } from "./views";

export const COMPARISON_ATTR_TYPE = "Comparison";

interface Attribute {
  _class?: string;
  type: string;
  value: string;
  private?: boolean;
}

/** The handles `attributeList` (a Media's own attribute_list) is set up to
 * compare against -- every Comparison-typed Attribute's value. */
export function comparisonTargets(attributeList: unknown): string[] {
  const attrs = (attributeList as Attribute[] | undefined) ?? [];
  return attrs.filter((a) => a.type === COMPARISON_ATTR_TYPE).map((a) => a.value);
}

/** Adds a Comparison attribute pointing `handle` at `otherHandle` -- a no-op
 * for whichever side (or both) is already linked, so re-picking the same
 * target from the RecordPicker doesn't create a duplicate row. */
async function addComparisonAttr(token: string, handle: string, otherHandle: string): Promise<void> {
  const obj = await fetchPlainObject(token, MEDIA_VIEW, handle);
  const attrs = ((obj.attribute_list as Attribute[] | undefined) ?? []) as Attribute[];
  if (attrs.some((a) => a.type === COMPARISON_ATTR_TYPE && a.value === otherHandle)) return;
  obj.attribute_list = [
    ...attrs,
    { _class: "Attribute", type: COMPARISON_ATTR_TYPE, value: otherHandle, private: false },
  ];
  await updateObject(token, MEDIA_VIEW, handle, obj);
}

/** Removes the Comparison attribute pointing `handle` at `otherHandle`
 * (addComparisonAttr's own dedupe means there's at most one to remove). */
async function removeComparisonAttr(token: string, handle: string, otherHandle: string): Promise<void> {
  const obj = await fetchPlainObject(token, MEDIA_VIEW, handle);
  const attrs = ((obj.attribute_list as Attribute[] | undefined) ?? []) as Attribute[];
  obj.attribute_list = attrs.filter(
    (a) => !(a.type === COMPARISON_ATTR_TYPE && a.value === otherHandle)
  );
  await updateObject(token, MEDIA_VIEW, handle, obj);
}

/** Links `handleA` and `handleB` as a comparison pair -- a Comparison
 * attribute on each pointing at the other. */
export async function attachComparison(token: string, handleA: string, handleB: string): Promise<void> {
  await addComparisonAttr(token, handleA, handleB);
  await addComparisonAttr(token, handleB, handleA);
}

/** Unlinks `handleA` and `handleB` -- removes the Comparison attribute from
 * both sides. */
export async function detachComparison(token: string, handleA: string, handleB: string): Promise<void> {
  await removeComparisonAttr(token, handleA, handleB);
  await removeComparisonAttr(token, handleB, handleA);
}
