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
  /** Set only on a childless node whose person's own already-fetched
   * `extended` data points at a parent/child handle beyond this branch's
   * current depth -- i.e. "this box is a real edge of the loaded tree, not
   * a true leaf" -- drives the auto-expand-on-reveal marker in
   * charts/treeChart.ts. Never set on a node that has `children`. */
  hasMore?: boolean;
}

function findPerson(data: TreePersonRaw[], handle: string | undefined): TreePersonRaw | undefined {
  if (!handle) return undefined;
  return data.find((p) => p.handle === handle);
}

function ancestorNode(
  data: TreePersonRaw[],
  handle: string | undefined,
  i: number,
  baseDepth: number,
  expanded: ReadonlySet<string>,
  includeEmpty: boolean,
  label: string,
): TreeNode {
  if (!handle) return {};
  const person = findPerson(data, handle);
  const node: TreeNode = {
    id: label,
    depth: i,
    nameGiven: person?.profile?.name_given ?? null,
    nameSurname: person?.profile?.name_surname ?? null,
    person: person ?? null,
  };
  const fatherHandle = person?.extended?.primary_parent_family?.father_handle;
  const motherHandle = person?.extended?.primary_parent_family?.mother_handle;
  // Past the base depth, a branch only keeps recursing once its own label
  // has been explicitly expanded (treeData's per-node lazy-expand) -- until
  // then this box is a real edge of the loaded tree, not a true leaf, iff
  // the person's own already-fetched `extended` data names a parent we
  // haven't loaded/shown yet.
  if (i >= baseDepth && !expanded.has(label)) {
    node.hasMore = !!(fatherHandle || motherHandle);
    return node;
  }
  node.children = [];
  if (fatherHandle || includeEmpty) {
    node.children.push(ancestorNode(data, fatherHandle, i + 1, baseDepth, expanded, includeEmpty, `${label}f`));
  }
  if (motherHandle || includeEmpty) {
    node.children.push(ancestorNode(data, motherHandle, i + 1, baseDepth, expanded, includeEmpty, `${label}m`));
  }
  return node;
}

/** `baseDepth` ancestor generations beyond the root are always expanded (0 =
 * root only); any branch in `expanded` (node labels like "pf"/"pfm", see
 * ancestorNode) recurses one further generation past that, regardless of
 * depth -- the per-node lazy-expand's own state, fed back in here so a
 * click/auto-reveal on one branch doesn't affect any other. With `expanded`
 * empty this is byte-for-byte the fixed-depth recursion this function used
 * to do (the old `generations` param is `baseDepth` unchanged).
 * `includeEmpty` defaults to `false` here to match gramps-web's *actual*
 * box-tree call site (GrampsjsTreeChart.js's
 * `getTree(this.data, handle, this.nAnc, false)`), not util.js's own
 * default of `true`, which only the Fan Chart actually uses (its wedge
 * geometry needs a uniform slot per generation regardless of whether that
 * ancestor is known). `true` here means every unknown ancestor still
 * reserves a full box-height layout slot all the way to the requested
 * depth -- which is what was stretching real siblings far apart whenever
 * their own ancestor lines ran out early, the common case for real data
 * more than a couple of generations back. */
export function buildAncestorTree(
  data: TreePersonRaw[],
  handle: string,
  baseDepth: number,
  expanded: ReadonlySet<string> = new Set(),
  includeEmpty = false,
): TreeNode {
  return ancestorNode(data, handle, 0, baseDepth, expanded, includeEmpty, "p");
}

function descendantNode(
  data: TreePersonRaw[],
  handle: string | undefined,
  i: number,
  baseDepth: number,
  expanded: ReadonlySet<string>,
  label: string,
): TreeNode {
  if (!handle) return {};
  const person = findPerson(data, handle);
  const node: TreeNode = {
    id: label,
    depth: i,
    nameGiven: person?.profile?.name_given ?? null,
    nameSurname: person?.profile?.name_surname ?? null,
    person: person ?? null,
  };
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
  if (i >= baseDepth && !expanded.has(label)) {
    node.hasMore = childHandles.length > 0;
    return node;
  }
  node.children = childHandles.map((childHandle, idx) =>
    descendantNode(data, childHandle, i + 1, baseDepth, expanded, `${label}c${idx}`)
  );
  return node;
}

/** `baseDepth` descendant generations beyond the root are always expanded (0
 * = root only); see buildAncestorTree's own doc comment -- same
 * base-depth-plus-per-branch-`expanded` shape, mirrored here. Ported from
 * gramps-web's getDescendantTree. */
export function buildDescendantTree(
  data: TreePersonRaw[],
  handle: string,
  baseDepth: number,
  expanded: ReadonlySet<string> = new Set(),
): TreeNode {
  return descendantNode(data, handle, 0, baseDepth, expanded, "p");
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

/** One person's immediate next generation in one direction -- the per-node
 * lazy-expand fetch, rooted at *that* person instead of the tree's root.
 * `nAnc=1,nDesc=0` (or the reverse) returns exactly the revealed person plus
 * their immediate parents/children, each already carrying their own
 * `extended`, so the newly-drawn boundary is itself immediately correct
 * about whether it needs its own hasMore marker -- no second round-trip. */
export async function fetchPersonExpansion(
  token: string,
  grampsId: string,
  direction: "ancestor" | "descendant",
): Promise<TreePersonRaw[]> {
  return direction === "ancestor"
    ? fetchTreeData(token, grampsId, 1, 0)
    : fetchTreeData(token, grampsId, 0, 1);
}

/** Merges a newly-fetched batch into the flat person list TreeView holds, by
 * handle -- the same person can legitimately arrive via two branches (e.g. a
 * cousin marriage), so this keeps `data` deduplicated rather than growing an
 * array with repeats each expand. */
export function mergeTreeData(base: TreePersonRaw[], incoming: TreePersonRaw[]): TreePersonRaw[] {
  const byHandle = new Map(base.map((p) => [p.handle, p]));
  for (const p of incoming) byHandle.set(p.handle, p);
  return Array.from(byHandle.values());
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
