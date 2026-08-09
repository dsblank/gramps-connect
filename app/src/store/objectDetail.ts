// Generic per-object detail fetch, reused by every RelatedPanel section
// regardless of object type -- one request combines everything a section
// needs: the raw object (ref-list arrays with their own frel/mrel/role/
// private/note_list/citation_list intact, untouched by `extend`), resolved
// forward-ref targets (`extended.*`), resolved backlink targets
// (`extended.backlinks.*`, since `extend=all` also covers backlinks when
// `obj.backlinks` is present -- see get_extended_attributes in gramps-web-
// api's resources/util.py), and computed profile sections extend can't
// derive (singular refs like Family's father/mother, or server-computed
// reverse lookups like Event's participants).
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import type { ViewConfig } from "./views";

/** The subset of ref-wrapper fields any of gramps-web-api's *ReferenceSchema
 * classes (ChildReferenceSchema, EventReferenceSchema, PersonReferenceSchema,
 * MediaReferenceSchema, RepositoryReferenceSchema -- see schemas.py:549-668)
 * may carry, alongside `ref` (the target handle). Every field but `ref` is
 * optional since which ones are present depends on which ref type this is. */
export interface RefMeta {
  private?: boolean;
  note_list?: string[];
  citation_list?: string[];
  /** ChildRef only: relationship to father/mother (Birth/Adopted/Step/...). */
  frel?: string;
  mrel?: string;
  /** EventRef only: the person/family's role in the event (Primary/Witness/...). */
  role?: string;
  /** PersonRef (association) only: free-text relationship description. */
  rel?: string;
  /** RepoRef only. */
  call_number?: string;
  media_type?: string;
  /** MediaRef only: crop rectangle [left, top, right, bottom] as percentages. */
  rect?: number[];
}

export type RawRef = RefMeta & { ref: string };

/** Loosely typed -- the raw object's own fields vary entirely by type (see
 * RELATED_CONFIG), so callers pull out whichever ref-list field their
 * section renders (e.g. `detail.child_ref_list as RawRef[]`) rather than
 * this module trying to model all 10 shapes. */
export type ObjectDetail = Record<string, unknown> & {
  handle: string;
  extended?: Record<string, unknown[]>;
  profile?: Record<string, unknown>;
};

/** A ViewConfig's endpoint is the .../query/ list route; the single-object
 * route (used both here and by notesApi.ts's attachNoteToObject) is the
 * same path with that trailing segment stripped (no trailing slash -- see
 * personProfile.ts's fetchPersonDetail doc comment; the single-object route
 * 404s if given one). */
export function endpointBaseFor(view: ViewConfig): string {
  return view.endpoint.replace(/query\/$/, "");
}

/** GET /api/<endpoint-base>/<handle>?extend=all&profile=all&backlinks=1 */
export async function fetchObjectExtended(token: string, view: ViewConfig, handle: string): Promise<ObjectDetail> {
  const url = `${API_BASE}${endpointBaseFor(view)}${encodeURIComponent(handle)}?extend=all&profile=all&backlinks=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }
  return (await res.json()) as ObjectDetail;
}

/** A raw ref-list field (e.g. `child_ref_list`) paired positionally with its
 * resolved `extended` counterpart (e.g. `extended.children`) -- every
 * *ReferenceSchema's `ref` is a bare handle, extend=all resolves it to a
 * full object but drops the wrapping ref's own frel/mrel/role/private, so
 * a section needs both arrays zipped together to show either side. Extra
 * elements on either side (a dangling ref extend couldn't resolve, or vice
 * versa) are dropped rather than mismatched. */
export function zipRefs<T>(rawList: unknown, extendedList: unknown): { ref: RawRef; target: T }[] {
  const raw = (rawList as RawRef[] | undefined) ?? [];
  const extended = (extendedList as T[] | undefined) ?? [];
  const length = Math.min(raw.length, extended.length);
  const result: { ref: RawRef; target: T }[] = [];
  for (let i = 0; i < length; i++) {
    result.push({ ref: raw[i], target: extended[i] });
  }
  return result;
}

/** Backlinks grouped by referencing object type (e.g. `{person: [...], event: [...]}`),
 * fully resolved -- present only when the request included both `extend=all`
 * and `backlinks=1` (see get_extended_attributes's backlinks handling). */
export function getBacklinks(detail: ObjectDetail): Record<string, unknown[]> {
  return (detail.extended?.backlinks as Record<string, unknown[]> | undefined) ?? {};
}
