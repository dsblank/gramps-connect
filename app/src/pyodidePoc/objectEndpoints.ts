// Minimal object-type -> endpoint map for the filter()/get_object() bridge
// (pyodideWorker.ts). Deliberately not reusing store/views.ts's VIEWS
// wholesale for this -- that file pulls in date/i18n formatting helpers
// with their own import surface not worth carrying into the worker bundle
// just to get these ten literal path strings (people/families are
// irregular plurals, not derivable from object_type by rule). Keep in
// sync with store/views.ts's own `endpoint` fields if a new object type is
// ever added there.
export const OBJECT_QUERY_ENDPOINTS: Record<string, string> = {
  person: "/api/people/query/",
  family: "/api/families/query/",
  event: "/api/events/query/",
  place: "/api/places/query/",
  repository: "/api/repositories/query/",
  source: "/api/sources/query/",
  citation: "/api/citations/query/",
  media: "/api/media/query/",
  note: "/api/notes/query/",
  tag: "/api/tags/query/",
};

/** The single-object GET base for the same type, e.g. "/api/people/" --
 * same derivation store/objectDetail.ts's endpointBaseFor() uses. */
export function objectEndpointBase(objectType: string): string | null {
  const queryEndpoint = OBJECT_QUERY_ENDPOINTS[objectType];
  return queryEndpoint ? queryEndpoint.replace(/query\/$/, "") : null;
}

/** The same 10 keys, in the order store/views.ts's own VIEWS array lists
 * them (person/family/event/place/repository/source/citation/media/note/
 * tag) -- for UI that needs "every object type" as a plain list (the
 * views-capability checkbox group in GrampletEditDialog, the "missing
 * means every type" normalization in grampletMedia.ts's fetchGramplets()). */
export const OBJECT_TYPES = Object.keys(OBJECT_QUERY_ENDPOINTS);

/** Display labels for the same keys -- singular ("Person", not
 * store/views.ts's sidebar-facing "People"), since these name an object
 * *type* for a Gramplet's own views-capability checkbox group, not a list
 * of records the way the sidebar's plural labels do. */
export const OBJECT_TYPE_LABELS: Record<string, string> = {
  person: "Person",
  family: "Family",
  event: "Event",
  place: "Place",
  repository: "Repository",
  source: "Source",
  citation: "Citation",
  media: "Media",
  note: "Note",
  tag: "Tag",
};
