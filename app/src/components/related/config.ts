// Which sections RelatedPanel renders for each object type, and in what
// order -- data, not code, same spirit as store/views.ts's ViewConfig.
// Checked against gramps' actual class hierarchy (gramps/gen/lib/*.py):
// Person and Family are "hub" objects with rich forward references: every
// other type has thin-to-nonexistent forward references of its own (an
// Event only points forward to its place; nothing points *from* Event to
// its participants, only the other way around) -- for those, "backlinks"
// (what points at this object) is the only place any relationship content
// comes from, so it's listed for every type, not bolted on as an
// afterthought.
export type RelatedSection =
  | "parents"
  | "families"
  | "children"
  | "associations"
  | "events"
  | "participants"
  | "place"
  | "parentPlaces"
  | "source"
  | "repositories"
  | "citations"
  | "notes"
  | "media"
  | "attributes"
  | "addresses"
  | "urls"
  | "tags"
  | "ldsOrdinances"
  | "backlinks";

export const RELATED_CONFIG: Record<string, RelatedSection[]> = {
  person: ["parents", "families", "associations", "events", "citations", "notes", "media", "attributes", "addresses", "urls", "tags", "ldsOrdinances", "backlinks"],
  family: ["parents", "children", "events", "citations", "notes", "media", "attributes", "tags", "ldsOrdinances", "backlinks"],
  event: ["place", "participants", "citations", "notes", "media", "attributes", "tags", "backlinks"],
  place: ["parentPlaces", "citations", "notes", "media", "urls", "tags", "backlinks"],
  repository: ["addresses", "urls", "notes", "tags", "backlinks"],
  // Source has no forward citation_list of its own -- citations point *at*
  // a source via their own source_handle, so "which citations use this
  // source" only ever shows up as a backlink, not a forward ref here.
  source: ["repositories", "media", "notes", "attributes", "tags", "backlinks"],
  citation: ["source", "media", "notes", "attributes", "tags", "backlinks"],
  media: ["citations", "notes", "attributes", "tags", "backlinks"],
  // The Output view (store/views.ts's GENERATED_VIEW) is Media
  // rows under a fixed tag filter, not a distinct object type -- same
  // sections as the ordinary Media view.
  generated: ["citations", "notes", "attributes", "tags", "backlinks"],
  note: ["tags", "backlinks"],
  tag: ["backlinks"],
};
