// Feeds View > Tree and the Person/Family "Tree" button. Unlike
// visualData.ts (Map/Timeline), this fetches over the network on each open
// rather than reading the local SQLite caches -- Person/Family don't cache
// parent_family_list/child_ref_list today, and adding them would force a
// one-time full recache for every user for a feature most won't open often.
// See ../../../gramps-web/src/charts/util.js and
// views/GrampsjsViewTreeChartBase.js's _getPersonRules/_fetchData, which
// this mirrors: one GET against the classic rule-filtered /api/people/
// (not the SQL-pushed-down /api/people/query/ views.ts's caches use).
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import { getViewStore } from "./registry";
import type { VisualSubject } from "../hash";

/** Only the fields gramps-web's charts/util.js actually reads off a
 * profile=self&extend=primary_parent_family,family_list person. birth/death
 * dates arrive already formatted text, not raw GrampsDate structs.
 * `media_list` is a base Person field (present with no extend needed) --
 * same shape objectDetail.ts's own RawRef/RefMeta types describe, `rect`
 * a `[left, top, right, bottom]` percentage crop when the reference has
 * one. */
export interface TreePersonRaw {
  handle: string;
  gramps_id: string;
  gender: number;
  profile?: {
    name_given?: string;
    name_surname?: string;
    birth?: { date?: string };
    death?: { date?: string };
  };
  media_list?: { ref: string; rect?: number[] }[];
  extended?: {
    primary_parent_family?: { father_handle?: string; mother_handle?: string };
    families?: {
      handle: string;
      father_handle?: string;
      mother_handle?: string;
      child_ref_list?: { ref: string; frel?: string; mrel?: string }[];
    }[];
  };
}

/** The nested shape d3-hierarchy wants, built from the flat TreePersonRaw[]
 * by walking handles (getTree/getDescendantTree's job below). An ancestor
 * slot for an unknown parent is `{}` -- no id/person/children at all, same
 * as gramps-web's own placeholder -- so the chart still draws the empty
 * generation shape instead of collapsing it. */
export interface TreeNode {
  id?: string;
  depth?: number;
  nameGiven?: string | null;
  nameSurname?: string | null;
  person?: TreePersonRaw | null;
  children?: TreeNode[];
}

function findPerson(data: TreePersonRaw[], handle: string | undefined): TreePersonRaw | undefined {
  if (!handle) return undefined;
  return data.find((p) => p.handle === handle);
}

function ancestorNode(
  data: TreePersonRaw[],
  handle: string | undefined,
  depth: number,
  includeEmpty: boolean,
  i: number,
  label: string,
): TreeNode {
  if (depth === 0) return {};
  const person = findPerson(data, handle);
  const node: TreeNode = {
    id: label,
    depth: i,
    nameGiven: person?.profile?.name_given ?? null,
    nameSurname: person?.profile?.name_surname ?? null,
    person: person ?? null,
  };
  if (depth === 1) return node;
  const fatherHandle = person?.extended?.primary_parent_family?.father_handle;
  const motherHandle = person?.extended?.primary_parent_family?.mother_handle;
  node.children = [];
  if (fatherHandle || includeEmpty) {
    node.children.push(ancestorNode(data, fatherHandle, depth - 1, includeEmpty, i + 1, `${label}f`));
  }
  if (motherHandle || includeEmpty) {
    node.children.push(ancestorNode(data, motherHandle, depth - 1, includeEmpty, i + 1, `${label}m`));
  }
  return node;
}

/** `generations` ancestor generations beyond the root (0 = root only).
 * Ported from gramps-web's getTree. */
export function buildAncestorTree(
  data: TreePersonRaw[],
  handle: string,
  generations: number,
  includeEmpty = true,
): TreeNode {
  return ancestorNode(data, handle, generations + 1, includeEmpty, 0, "p");
}

function descendantNode(data: TreePersonRaw[], handle: string | undefined, depth: number, i: number, label: string): TreeNode {
  if (depth === 0) return {};
  const person = findPerson(data, handle);
  const node: TreeNode = {
    id: label,
    depth: i,
    nameGiven: person?.profile?.name_given ?? null,
    nameSurname: person?.profile?.name_surname ?? null,
    person: person ?? null,
  };
  if (depth === 1) return node;
  const childHandles = (person?.extended?.families ?? []).flatMap((fam) => {
    const isFather = fam.father_handle === person?.handle;
    const isMother = fam.mother_handle === person?.handle;
    if (!isFather && !isMother) return [];
    // Which relationship field names *this* parent's link to the child --
    // matches gramps-web exactly, including its own limitation of only
    // following "Birth" relationships (adopted/step children don't appear).
    const relationKey: "frel" | "mrel" = isFather ? "frel" : "mrel";
    return (fam.child_ref_list ?? [])
      .filter((ref) => ref[relationKey] === "Birth")
      .map((ref) => ref.ref);
  });
  node.children = childHandles.map((childHandle, idx) =>
    descendantNode(data, childHandle, depth - 1, i + 1, `${label}c${idx}`)
  );
  return node;
}

/** `generations` descendant generations beyond the root (0 = root only).
 * Ported from gramps-web's getDescendantTree. */
export function buildDescendantTree(data: TreePersonRaw[], handle: string, generations: number): TreeNode {
  return descendantNode(data, handle, generations + 1, 0, "p");
}

/** GET /api/people/?rules=...&profile=self&extend=primary_parent_family,
 * family_list -- the classic rule-filtered endpoint gramps-web's tree charts
 * use, not the SQL-pushed-down /api/people/query/ views.ts's local caches
 * read. `nAnc+1`/`nDesc+1`: IsLessThanNthGenerationAncestorOf/DescendantOf's
 * N counts generations including the root itself (N=1 is self only), so
 * "nAnc ancestor generations beyond the root" needs N = nAnc+1 -- same
 * arithmetic as gramps-web's own _getPersonRules. */
export async function fetchTreeData(token: string, grampsId: string, nAnc: number, nDesc: number): Promise<TreePersonRaw[]> {
  const rules = {
    function: "or",
    rules: [
      { name: "IsLessThanNthGenerationAncestorOf", values: [grampsId, nAnc + 1] },
      { name: "IsLessThanNthGenerationDescendantOf", values: [grampsId, nDesc + 1] },
    ],
  };
  const url = `${API_BASE}/api/people/?rules=${encodeURIComponent(JSON.stringify(rules))}&profile=self&extend=primary_parent_family,family_list`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const body = await res.json();
  // A bare array, not gramps-web's own {data: [...]} envelope -- this GET
  // (unlike the paginated /api/people/query/ views.ts's caches use) returns
  // the matched people directly.
  if (Array.isArray(body)) return body as TreePersonRaw[];
  throw new Error(body?.error?.message ?? "Failed to load tree data");
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** A person's box thumbnail: their `media_list`'s first entry, cropped to
 * its rect (gramps-web-api's percentage-based
 * `/cropped/<x1>/<y1>/<x2>/<y2>/thumbnail/<size>` route, integers 0-100 --
 * same convention gramps-web's own charts/util.js `getImageUrl`/
 * `normalizeRect` use) when the reference has one, else the plain
 * `/thumbnail/<size>` route. Null when the person has no media at all.
 * `jwt` as a query param is the only way to authenticate a plain URL an
 * SVG `<image>` can use -- same convention as MediaThumbnail.tsx's
 * `<img src>`. */
export function personThumbnailUrl(token: string, person: TreePersonRaw, size: number): string | null {
  const ref = person.media_list?.[0];
  if (!ref?.ref) return null;
  const base = `${API_BASE}/api/media/${encodeURIComponent(ref.ref)}`;
  const jwt = encodeURIComponent(token);
  const rect = ref.rect;
  if (rect && rect.length === 4) {
    const [x1, y1, x2, y2] = rect.map(clampPct);
    if (x2 > x1 && y2 > y1) {
      return `${base}/cropped/${x1}/${y1}/${x2}/${y2}/thumbnail/${size}?square=true&jwt=${jwt}`;
    }
  }
  return `${base}/thumbnail/${size}?jwt=${jwt}`;
}

export interface TreeRoot {
  handle: string;
  grampsId: string;
  label: string;
}

async function personRoot(handle: string): Promise<TreeRoot | null> {
  await getViewStore("person").ensureLoaded();
  const row = getViewStore("person").readRowByHandle(handle, ["gramps_id", "given_name", "surname"]);
  if (!row) return null;
  const [grampsId, given, surname] = row as [string | null, string | null, string | null];
  if (!grampsId) return null;
  return { handle, grampsId, label: [given, surname].filter(Boolean).join(" ") || "(unnamed person)" };
}

/** The tree's root person for a routed VisualSubject: the person themselves,
 * or -- for a family -- the father (else the mother). Reads the same
 * low-level pieces store/visualScope.ts's resolveFamily/resolvePerson do
 * (getViewStore + readRowByHandle, after ensureLoaded()), not
 * useVisualScope itself -- that hook resolves event/place handles for
 * Map/Timeline, the wrong shape for a root person. Null when the subject
 * can't be resolved: a stale/still-syncing handle, or a family with
 * neither parent set. */
export async function resolveTreeRoot(subject: VisualSubject | null): Promise<TreeRoot | null> {
  if (!subject) return null;
  if (subject.type === "person") return personRoot(subject.handle);
  if (subject.type === "family") {
    await getViewStore("family").ensureLoaded();
    const row = getViewStore("family").readRowByHandle(subject.handle, ["father_handle", "mother_handle"]);
    if (!row) return null;
    const [fatherHandle, motherHandle] = row as [string | null, string | null];
    const rootHandle = fatherHandle || motherHandle;
    if (!rootHandle) return null;
    return personRoot(rootHandle);
  }
  return null;
}
