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

// Within each type's list, sections whose rows are edited in place -- via a
// (+) Add button and per-row edit/delete (see AttachControl in sections/
// shared.tsx: citations, notes, media, tags) -- are ordered *after* every
// section whose content can only be changed by editing the object itself
// (parents, events, attributes, ...). Keeping that split consistent makes it
// visually obvious, without reading each section, which parts of the panel
// you can act on directly versus which require opening the edit dialog.
// "backlinks" ("Referenced by") is neither -- purely read-only, nothing here
// points at it -- so it sits last of all, after even the (+) Add sections.
export const RELATED_CONFIG: Record<string, RelatedSection[]> = {
  person: ["parents", "families", "associations", "events", "attributes", "addresses", "urls", "ldsOrdinances", "citations", "notes", "media", "tags", "backlinks"],
  family: ["parents", "children", "events", "attributes", "ldsOrdinances", "citations", "notes", "media", "tags", "backlinks"],
  event: ["place", "participants", "attributes", "citations", "notes", "media", "tags", "backlinks"],
  place: ["parentPlaces", "urls", "citations", "notes", "media", "tags", "backlinks"],
  repository: ["addresses", "urls", "notes", "tags", "backlinks"],
  // Source has no forward citation_list of its own -- citations point *at*
  // a source via their own source_handle, so "which citations use this
  // source" only ever shows up as a backlink, not a forward ref here.
  source: ["repositories", "attributes", "media", "notes", "tags", "backlinks"],
  citation: ["source", "attributes", "media", "notes", "tags", "backlinks"],
  media: ["attributes", "citations", "notes", "tags", "backlinks"],
  // The Output view (store/views.ts's GENERATED_VIEW) is Media
  // rows under a fixed tag filter, not a distinct object type -- same
  // sections as the ordinary Media view.
  generated: ["attributes", "citations", "notes", "tags", "backlinks"],
  note: ["tags", "backlinks"],
  messages: ["tags", "backlinks"],
  tag: ["backlinks"],
};
