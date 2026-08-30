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

/** GET /api/<endpoint-base>/<handle>?extend=all&profile=all&backlinks=1 --
 * the heaviest object-fetch endpoint this app calls, so a caller driven by
 * something that can change rapidly (RelatedPanel.tsx's own selection, via
 * arrow-key repeat) should pass `signal` and actually abort a request it no
 * longer needs, not just ignore its eventual response client-side -- fewer
 * requests genuinely in flight at once, and a closed connection at least
 * gives the server a chance to notice and stop, rather than a guaranteed
 * client-side-only saving. */
export async function fetchObjectExtended(
  token: string,
  view: ViewConfig,
  handle: string,
  signal?: AbortSignal
): Promise<ObjectDetail> {
  const url = `${API_BASE}${endpointBaseFor(view)}${encodeURIComponent(handle)}?extend=all&profile=all&backlinks=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
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

/** Backlink types whose raw one-level-deep shape is missing something
 * summaryLine's case needs (family: father/mother; citation: source) *and*
 * whose `profile.references` twin is a safe, strictly-richer substitute --
 * confirmed against a live gramps-web-api instance for every backlink type:
 * profile Place flattens `name` to a plain string (raw's `name.value`
 * lookup would break), profile Media drops `desc`/`path` entirely, and
 * profile Event's `date` is a pre-formatted string, not the GrampsDate
 * struct `displayDate()` expects -- swapping any of those in would trade one
 * missing-label bug for another. Person/Note/Repository/Source/Tag all read
 * fields (`primary_name`, `text.string`, `name`, `title`) that are native to
 * the raw object already, no swap needed. Keep this in sync with
 * summary.ts's `summaryText` if a new case there starts reading a nested
 * ref field the same way family/citation do. */
const PROFILE_RESOLVED_BACKLINK_TYPES = new Set(["family", "citation"]);

/** Backlinks grouped by referencing object type (e.g. `{person: [...], event: [...]}`)
 * -- present only when the request included both `extend=all` and
 * `backlinks=1` (see get_extended_attributes's backlinks handling).
 *
 * `extended.backlinks.*` itself is only resolved *one level deep*: a
 * backlink Family, for instance, comes back with `father_handle`/
 * `mother_handle` as bare handles, not a resolved `father`/`mother` (extend
 * already spent its one hop resolving the backlink's own handle into an
 * object -- it doesn't recurse into that object's own refs). `profile.
 * references` is the same backlinks-by-type map, but profile-shaped
 * (father/mother with `name_display`, etc.) -- computed server-side the
 * same way `profile.families`/`primary_parent_family` are for a Person's
 * *forward* refs. So, for the types in PROFILE_RESOLVED_BACKLINK_TYPES
 * above, each raw backlink item is swapped for its profile.references twin
 * (matched by handle) when one exists, rather than left as a
 * summary-less raw record (see summary.ts's family/citation cases, which
 * need that nesting). */
export function getBacklinks(detail: ObjectDetail): Record<string, unknown[]> {
  const raw = (detail.extended?.backlinks as Record<string, unknown[]> | undefined) ?? {};
  const references = (detail.profile?.references as Record<string, { handle: string }[]> | undefined) ?? {};
  const result: Record<string, unknown[]> = {};
  for (const [type, items] of Object.entries(raw)) {
    if (!PROFILE_RESOLVED_BACKLINK_TYPES.has(type)) {
      result[type] = items;
      continue;
    }
    const resolved = new Map((references[type] ?? []).map((r) => [r.handle, r]));
    result[type] = items.map((item) => {
      const handle = (item as { handle?: string }).handle;
      return (handle && resolved.get(handle)) ?? item;
    });
  }
  return result;
}
