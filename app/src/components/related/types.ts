import type { ObjectDetail, RefMeta } from "../../store/objectDetail";

/** Every section calls this instead of navigating directly -- RelatedPanel
 * is mounted twice (top pane vs. inside ReferenceDetail's bottom pane) with
 * two different implementations wired in by AsideSplit: top sets a local
 * sub-selection, bottom rewrites location.hash to actually switch views. */
export type OnNavigate = (type: string, handle: string, refMeta?: RefMeta) => void;

/** Every section component -- generic or type-specific -- has this same
 * shape: which object type is being rendered (RELATED_CONFIG's key -- a
 * few sections, like ParentsSection, render differently for "person" vs.
 * "family" since the same section name means a differently-shaped fetch on
 * each), the fetched object (already carrying `extended`/`profile`/
 * `backlinks`), and the navigate callback to wire into its RefRows. */
export interface SectionProps {
  type: string;
  detail: ObjectDetail;
  onNavigate: OnNavigate;
}
