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
  | "comparisons"
  | "attributes"
  | "addresses"
  | "urls"
  | "tags"
  | "ldsOrdinances"
  | "backlinks";

// Ordering within each type's list is a holdover from when citations/
// notes/media/tags were edited in place here via a (+) Add button and
// per-row edit/delete (AttachControl, sections/shared.tsx); that live
// attach/detach is back for those four (Notes/Citations/Tags/Media, see
// each section's own `canAttach` and AttachControl.tsx) as a quicker path
// alongside the full edit dialog (PersonEditDialog.tsx/
// FamilyEditDialog.tsx/ObjectEditDialog.tsx's RefListField/MediaListField/
// EventsField, RefPickerField.tsx), not a replacement for it -- other
// sections (Children/Events/Associations/Repositories/parents/place/
// source/families/participants) are gaining the same "+"/"−" too, each
// via its own live attach/detach or set/clear against refListApi.ts.
// "backlinks" ("Referenced by") stays purely read-only regardless -- a
// reverse ref isn't owned by the displayed object -- and last in every
// list. Events sits on Person/Family only (Event's own entry below has no
// `events` of its own) -- both share EventBase's event_ref_list.
export const RELATED_CONFIG: Record<string, RelatedSection[]> = {
  person: ["events", "tags", "media", "parents", "families", "addresses", "urls", "ldsOrdinances", "notes", "attributes", "citations", "associations", "backlinks"],
  family: ["parents", "children", "events", "tags", "media", "ldsOrdinances", "notes", "attributes", "citations", "backlinks"],
  event: ["tags", "media", "place", "participants", "notes", "attributes", "citations", "backlinks"],
  place: ["tags", "media", "parentPlaces", "urls", "notes", "citations", "backlinks"],
  repository: ["tags", "addresses", "urls", "notes", "backlinks"],
  // Source has no forward citation_list of its own -- citations point *at*
  // a source via their own source_handle, so "which citations use this
  // source" only ever shows up as a backlink, not a forward ref here.
  source: ["tags", "media", "repositories", "notes", "attributes", "backlinks"],
  citation: ["tags", "media", "source", "notes", "attributes", "backlinks"],
  media: ["tags", "comparisons", "notes", "attributes", "citations", "backlinks"],
  // The Output view (store/views.ts's GENERATED_VIEW) is Media
  // rows under a fixed tag filter, not a distinct object type -- same
  // sections as the ordinary Media view, minus Comparisons (generated
  // items aren't compared against each other the way duplicate-merge
  // candidates are).
  generated: ["tags", "notes", "attributes", "citations", "backlinks"],
  note: ["tags", "backlinks"],
  messages: ["tags", "backlinks"],
  story: ["tags", "backlinks"],
  tag: ["backlinks"],
};
