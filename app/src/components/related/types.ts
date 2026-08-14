import type { ObjectDetail, RefMeta } from "../../store/objectDetail";
import type { ViewConfig } from "../../store/views";

/** Every section calls this instead of navigating directly -- RelatedPanel
 * is mounted twice (top pane vs. inside ReferenceDetail's bottom pane) with
 * two different implementations wired in by AsideSplit: top sets a local
 * sub-selection, bottom rewrites location.hash to actually switch views. */
export type OnNavigate = (type: string, handle: string, refMeta?: RefMeta) => void;

export interface GalleryItem {
  handle: string;
  mime?: string;
}

/** MediaSection's own escape hatch from the standard onNavigate flow -- a
 * record can carry hundreds of attached photos (see MediaSection's doc
 * comment), so unlike every other section it never expands an inline list
 * of RefRows; this hands the already-resolved item list straight to
 * ReferenceDetail's gallery view instead, without a second fetch. Only
 * wired up for the top pane (see AsideSplit) -- the bottom pane has
 * nowhere further to hand a gallery off to. */
export type OnViewGallery = (items: GalleryItem[], label: string) => void;

/** Every section component -- generic or type-specific -- has this same
 * shape: which object type is being rendered (RELATED_CONFIG's key -- a
 * few sections, like ParentsSection, render differently for "person" vs.
 * "family" since the same section name means a differently-shaped fetch on
 * each), the fetched object (already carrying `extended`/`profile`/
 * `backlinks`), and the navigate callback to wire into its RefRows.
 * `onViewGallery` is optional and only meaningful to MediaSection --
 * everything else ignores it. `view` and `onRefetch` are only used by the
 * four sections with an AttachControl (Notes/Citations/Tags/Media): `view`
 * is `type`'s own ViewConfig (needed for refListApi.ts's GET/PUT, which
 * `type` alone as a bare string can't provide), and `onRefetch` lets a
 * section trigger RelatedPanel's own refetch after an attach/detach, the
 * same mechanism MessageButton's `onAttached` already uses. */
export interface SectionProps {
  type: string;
  view: ViewConfig;
  detail: ObjectDetail;
  onNavigate: OnNavigate;
  onViewGallery?: OnViewGallery;
  onRefetch?: () => void;
}
