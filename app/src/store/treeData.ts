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
import { mediaThumbnailUrl } from "./mediaCrop";
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
  collapsed: ReadonlySet<string>,
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
  // haven't loaded/shown yet. A label in `collapsed` (the "Collapse
  // ancestors" button) forces the same boundary even *within* base depth --
  // unless `expanded` (a later click on its own "+") says otherwise, so
  // re-expanding always wins over a stale collapse.
  const isExpanded = expanded.has(label);
  if ((i >= baseDepth && !isExpanded) || (collapsed.has(label) && !isExpanded)) {
    node.hasMore = !!(fatherHandle || motherHandle);
    return node;
  }
  node.children = [];
  if (fatherHandle || includeEmpty) {
    node.children.push(ancestorNode(data, fatherHandle, i + 1, baseDepth, expanded, collapsed, includeEmpty, `${label}f`));
  }
  if (motherHandle || includeEmpty) {
    node.children.push(ancestorNode(data, motherHandle, i + 1, baseDepth, expanded, collapsed, includeEmpty, `${label}m`));
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
  collapsed: ReadonlySet<string> = new Set(),
  includeEmpty = false,
): TreeNode {
  return ancestorNode(data, handle, 0, baseDepth, expanded, collapsed, includeEmpty, "p");
}

function descendantNode(
  data: TreePersonRaw[],
  handle: string | undefined,
  i: number,
  baseDepth: number,
  expanded: ReadonlySet<string>,
  collapsed: ReadonlySet<string>,
  relaxed: ReadonlySet<string> | "all",
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
  // `relaxed` (the Family graph's own descendant rendering, always "all")
  // drops the Birth-only filter so step/adopted children show too -- the
  // box-tree's own callers pass an empty Set, leaving this filter exactly as
  // it always has been for them.
  const isRelaxed = relaxed === "all" || relaxed.has(label);
  const childHandles = (person?.extended?.families ?? []).flatMap((fam) => {
    const isFather = fam.father_handle === person?.handle;
    const isMother = fam.mother_handle === person?.handle;
    if (!isFather && !isMother) return [];
    // Which relationship field names *this* parent's link to the child --
    // matches gramps-web exactly, including its own limitation of only
    // following "Birth" relationships (adopted/step children don't appear),
    // unless `isRelaxed`.
    const relationKey: "frel" | "mrel" = isFather ? "frel" : "mrel";
    const refs = isRelaxed
      ? (fam.child_ref_list ?? [])
      : (fam.child_ref_list ?? []).filter((ref) => ref[relationKey] === "Birth");
    return refs.map((ref) => ref.ref);
  });
  // See ancestorNode's matching comment -- `collapsed` forces the same
  // boundary within base depth, unless a later re-expand of this exact
  // label overrides it.
  const isExpanded = expanded.has(label);
  if ((i >= baseDepth && !isExpanded) || (collapsed.has(label) && !isExpanded)) {
    node.hasMore = childHandles.length > 0;
    return node;
  }
  node.children = childHandles.map((childHandle, idx) =>
    descendantNode(data, childHandle, i + 1, baseDepth, expanded, collapsed, relaxed, `${label}c${idx}`)
  );
  return node;
}

/** `baseDepth` descendant generations beyond the root are always expanded (0
 * = root only); see buildAncestorTree's own doc comment -- same
 * base-depth-plus-per-branch-`expanded` shape, mirrored here. Ported from
 * gramps-web's getDescendantTree. `relaxed` -- "all", or a set of labels --
 * drops the Birth-only child filter; the box-tree's own callers leave it at
 * the default empty Set, so its rendering is unaffected. */
export function buildDescendantTree(
  data: TreePersonRaw[],
  handle: string,
  baseDepth: number,
  expanded: ReadonlySet<string> = new Set(),
  collapsed: ReadonlySet<string> = new Set(),
  relaxed: ReadonlySet<string> | "all" = new Set(),
): TreeNode {
  return descendantNode(data, handle, 0, baseDepth, expanded, collapsed, relaxed, "p");
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

export interface ClusterSibling {
  person: TreePersonRaw;
  /** Relative to the cluster's own anchor, and always a *blood* tie where
   * claimed: "full" shares both parents by birth, "half-father"/
   * "half-mother" shares only that one by birth, and "step" shares neither
   * by birth even though one of this person's own parents matches one of
   * the anchor's (e.g. the anchor's father's third wife's own children --
   * their tie to the anchor is only ever through that marriage, never
   * blood). Someone with neither parent known in common never appears here
   * at all -- see computeClusterSiblings. */
  relation: "full" | "half-father" | "half-mother" | "step";
  frel?: string;
  mrel?: string;
  isAnchor: boolean;
}

/** Whether a child_ref's own frel/mrel marks a *blood* tie to that specific
 * parent -- Gramps' ChildRefType default is "Birth" (often left unset by
 * the API rather than spelled out), every other value (Stepchild, Adopted,
 * Foster, Sponsored, Unknown, ...) means this parent isn't a biological one
 * for this specific child, even within a family where the *other* parent
 * -- or other children -- are. */
function isBloodChildRel(rel: string | undefined): boolean {
  return !rel || rel === "Birth";
}

export interface FamilyClusterNode {
  id: string;
  siblings: ClusterSibling[];
  /** Keyed by parentPairKey -- i.e. per full-sibling group (see
   * groupSiblingsByParents, FamilyGraphView.tsx), not per whole cluster.
   * Two different groups (e.g. the anchor's own full-sibling group and a
   * half-sibling branch) can have entirely different parents, so each
   * group's own expansion needs its own entry to draw a connector to the
   * right boxes -- a flat cluster-wide list can't tell those apart. Each
   * entry has 0-2 clusters (father's, mother's, or both, whichever are
   * known) for that specific group. Absent (not just empty) for a group
   * that hasn't been expanded "up" yet. */
  parentClustersByGroup: Record<string, FamilyClusterNode[]>;
}

/** Every child of either of `person`'s two known parents, across *every*
 * marriage either parent is part of -- not just `person`'s own primary
 * family -- so half-siblings from a parent's other relationship are
 * included. Unlike descendantNode's own walk, every frel/mrel is kept (no
 * Birth-only filter): step/adopted siblings are exactly what the Family
 * graph exists to surface. Requires the father/mother TreePersonRaw rows (if
 * their handles are known) to already be in `data` with their own
 * `extended.families` populated, and each resulting sibling's own row to
 * already be in `data` too -- see missingParentHandles/missingSiblingHandles
 * and ensureClusterLoaded below, which guarantee this before calling here. */
export function computeClusterSiblings(data: TreePersonRaw[], person: TreePersonRaw): ClusterSibling[] {
  const fatherHandle = person.extended?.primary_parent_family?.father_handle;
  const motherHandle = person.extended?.primary_parent_family?.mother_handle;
  const father = findPerson(data, fatherHandle);
  const mother = findPerson(data, motherHandle);
  const families = [...(father?.extended?.families ?? []), ...(mother?.extended?.families ?? [])];
  const seenFamilyHandles = new Set<string>();
  const byHandle = new Map<string, ClusterSibling>();
  for (const fam of families) {
    if (seenFamilyHandles.has(fam.handle)) continue;
    seenFamilyHandles.add(fam.handle);
    // Whether this family's own father/mother slot is filled by one of the
    // anchor's own parents at all -- a family neither parent is in has
    // nothing relevant in it. Deliberately *not* an aggregate "isFull" for
    // the whole family: a blended family's own child_ref_list can mix
    // frel/mrel values per child (the father's own kids as Birth alongside
    // his wife's kids from a prior marriage as Step to him), so which
    // parent this specific child is a *blood* tie to has to be decided
    // per-child, below, not once for the family as a whole.
    const matchesFather = !!fatherHandle && fam.father_handle === fatherHandle;
    const matchesMother = !!motherHandle && fam.mother_handle === motherHandle;
    if (!matchesFather && !matchesMother) continue;
    for (const ref of fam.child_ref_list ?? []) {
      if (byHandle.has(ref.ref)) continue;
      const siblingPerson = findPerson(data, ref.ref);
      if (!siblingPerson) continue; // not fetched yet -- missingSiblingHandles catches this
      const bloodFather = matchesFather && isBloodChildRel(ref.frel);
      const bloodMother = matchesMother && isBloodChildRel(ref.mrel);
      const relation: ClusterSibling["relation"] =
        bloodFather && bloodMother ? "full" : bloodFather ? "half-father" : bloodMother ? "half-mother" : "step";
      byHandle.set(ref.ref, {
        person: siblingPerson,
        relation,
        frel: ref.frel,
        mrel: ref.mrel,
        isAnchor: ref.ref === person.handle,
      });
    }
  }
  // `person` always belongs to their own cluster, even with no parents
  // recorded at all (no families to walk above).
  if (!byHandle.has(person.handle)) {
    byHandle.set(person.handle, { person, relation: "full", isAnchor: true });
  }
  return Array.from(byHandle.values());
}

/** `person`'s own two parent handles not yet present in `data` -- the first
 * fetch ensureClusterLoaded needs before computeClusterSiblings can see
 * either parent's `extended.families`. */
export function missingParentHandles(data: TreePersonRaw[], person: TreePersonRaw): string[] {
  const fatherHandle = person.extended?.primary_parent_family?.father_handle;
  const motherHandle = person.extended?.primary_parent_family?.mother_handle;
  return [fatherHandle, motherHandle].filter((h): h is string => !!h && !findPerson(data, h));
}

/** Once `person`'s parents are loaded, every sibling handle
 * computeClusterSiblings would want to include but whose own row isn't in
 * `data` yet. */
export function missingSiblingHandles(data: TreePersonRaw[], person: TreePersonRaw): string[] {
  const fatherHandle = person.extended?.primary_parent_family?.father_handle;
  const motherHandle = person.extended?.primary_parent_family?.mother_handle;
  const father = findPerson(data, fatherHandle);
  const mother = findPerson(data, motherHandle);
  const families = [...(father?.extended?.families ?? []), ...(mother?.extended?.families ?? [])];
  const seenRefs = new Set<string>();
  const missing: string[] = [];
  for (const fam of families) {
    const isRelevant = (!!fatherHandle && fam.father_handle === fatherHandle) || (!!motherHandle && fam.mother_handle === motherHandle);
    if (!isRelevant) continue;
    for (const ref of fam.child_ref_list ?? []) {
      if (seenRefs.has(ref.ref)) continue;
      seenRefs.add(ref.ref);
      if (!findPerson(data, ref.ref)) missing.push(ref.ref);
    }
  }
  return missing;
}

/** `${fatherHandle}:${motherHandle}` (each `"-"` if unknown) -- two
 * siblings with the identical pair will always expand "up" into the exact
 * same further-ancestor branch, so this is the natural key for *grouping*
 * a cluster's siblings for display (all full siblings of each other,
 * whether or not they're full siblings of the cluster's own anchor) and for
 * de-duplicating the "expand parents" action across them: clicking it for
 * any one member should mark the whole pair-group expanded, not just that
 * one person. Exported so FamilyGraphView's own grouping uses the exact
 * same key format as familyClusterNode's own recursion check below. */
export function parentPairKey(person: TreePersonRaw): string {
  const fatherHandle = person.extended?.primary_parent_family?.father_handle ?? "-";
  const motherHandle = person.extended?.primary_parent_family?.mother_handle ?? "-";
  return `${fatherHandle}:${motherHandle}`;
}

/** Every spouse `person` has across all their own families -- the *other*
 * parent in each family `person` is themselves a parent of, deduped. Zero,
 * one, or several (remarriage). Used by the Family graph's own "Expand
 * spouses" (FamilyGraphView.tsx/TreeView.tsx) to show them alongside
 * `person`'s own card, wherever it appears. */
export function computeSpouseHandles(person: TreePersonRaw): string[] {
  const handles = new Set<string>();
  for (const fam of person.extended?.families ?? []) {
    if (fam.father_handle === person.handle && fam.mother_handle) handles.add(fam.mother_handle);
    else if (fam.mother_handle === person.handle && fam.father_handle) handles.add(fam.father_handle);
  }
  return Array.from(handles);
}

export interface SiblingGroup {
  key: string;
  siblings: ClusterSibling[];
}

/** Groups a cluster's siblings by their own shared parent pair
 * (parentPairKey) -- i.e. full siblings of *each other*, whether or not
 * they're full siblings of the cluster's own anchor -- in first-appearance
 * order. The single source of truth for this grouping: familyClusterNode
 * (below) uses it to decide what "expand parents" recurses into per group,
 * and FamilyGraphView.tsx's own rendering uses the exact same grouping to
 * draw one bordered box + one "+" + one connector per group, so the two
 * never disagree about where a group boundary falls. */
export function groupSiblingsByParents(siblings: ClusterSibling[]): SiblingGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, ClusterSibling[]>();
  for (const sib of siblings) {
    const key = parentPairKey(sib.person);
    let group = byKey.get(key);
    if (!group) {
      group = [];
      byKey.set(key, group);
      order.push(key);
    }
    group.push(sib);
  }
  return order.map((key) => ({ key, siblings: byKey.get(key)! }));
}

/** GET /api/people/<handle>?profile=self&extend=primary_parent_family,
 * family_list -- same query shape/TreePersonRaw as fetchTreeData, just a
 * direct by-handle GET (the pattern objectDetail.ts's fetchObjectExtended
 * already uses elsewhere) rather than the rules-based by-gramps_id list
 * endpoint, since the Family graph only ever has handles (child_ref_list
 * entries, parent handles) to work from, never gramps_ids. Bare object, no
 * envelope -- same as objectDetail.ts's own by-handle GET. */
export async function fetchPersonByHandle(token: string, handle: string): Promise<TreePersonRaw> {
  const url = `${API_BASE}/api/people/${encodeURIComponent(handle)}?profile=self&extend=primary_parent_family,family_list`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return (await res.json()) as TreePersonRaw;
}

/** Ensures `data` has everything computeClusterSiblings(data, anchor) needs
 * to return `anchor`'s complete sibling list: `anchor`'s own row, `anchor`'s
 * parents' rows, and every one of `anchor`'s siblings' own rows. Three
 * sequential fetch-and-merge rounds (each depends on the previous already
 * being merged in) rather than one -- the person's row is needed to read
 * their parent handles, and the parents' rows are needed to read the
 * families whose child_ref_lists name the siblings. */
export async function ensureClusterLoaded(
  token: string,
  data: TreePersonRaw[],
  anchorHandle: string,
): Promise<TreePersonRaw[]> {
  let result = data;
  let anchor = findPerson(result, anchorHandle);
  if (!anchor) {
    anchor = await fetchPersonByHandle(token, anchorHandle);
    result = mergeTreeData(result, [anchor]);
  }
  const parentHandles = missingParentHandles(result, anchor);
  if (parentHandles.length > 0) {
    const rows = await Promise.all(parentHandles.map((h) => fetchPersonByHandle(token, h)));
    result = mergeTreeData(result, rows);
  }
  const siblingHandles = missingSiblingHandles(result, anchor);
  if (siblingHandles.length > 0) {
    const rows = await Promise.all(siblingHandles.map((h) => fetchPersonByHandle(token, h)));
    result = mergeTreeData(result, rows);
  }
  return result;
}

function familyClusterNode(
  data: TreePersonRaw[],
  anchor: TreePersonRaw,
  expandedUp: ReadonlySet<string>,
  label: string,
): FamilyClusterNode {
  const siblings = computeClusterSiblings(data, anchor);
  const parentClustersByGroup: Record<string, FamilyClusterNode[]> = {};
  for (const group of groupSiblingsByParents(siblings)) {
    if (!expandedUp.has(`${label}:${group.key}`)) continue;
    // Every member shares this exact parent pair by construction (that's
    // the grouping key), so reading it off the first member applies to the
    // whole group -- no per-sibling dedup needed the way a flat per-person
    // loop would have.
    const representative = group.siblings[0].person;
    const fatherHandle = representative.extended?.primary_parent_family?.father_handle;
    const motherHandle = representative.extended?.primary_parent_family?.mother_handle;
    const clusters: FamilyClusterNode[] = [];
    for (const parentHandle of [fatherHandle, motherHandle]) {
      if (!parentHandle) continue;
      const parentPerson = findPerson(data, parentHandle);
      if (!parentPerson) continue; // ensureClusterLoaded didn't run yet for this parent -- skip until it has
      clusters.push(familyClusterNode(data, parentPerson, expandedUp, `${label}:${parentHandle}`));
    }
    if (clusters.length > 0) parentClustersByGroup[group.key] = clusters;
  }
  return { id: label, siblings, parentClustersByGroup };
}

/** The Family graph's own root: `rootHandle`'s cluster (their own siblings),
 * plus one further cluster per sibling whose key (`${label}:${handle}`,
 * `label` starting as `rootLabel`, `"fc"` by default) is in `expandedUp` --
 * the up-direction counterpart to buildAncestorTree/buildDescendantTree's
 * own expanded-label-set recursion. `rootLabel` lets a caller building more
 * than one independent cluster in the same graph (e.g. TreeView.tsx's own
 * "Expand spouses" -- a spouse gets their own cluster, not the main one)
 * give each its own namespaced label prefix, so their expand states and
 * per-node ids never collide. */
export function buildFamilyClusterTree(
  data: TreePersonRaw[],
  rootHandle: string,
  expandedUp: ReadonlySet<string>,
  rootLabel = "fc",
): FamilyClusterNode | null {
  const root = findPerson(data, rootHandle);
  if (!root) return null;
  return familyClusterNode(data, root, expandedUp, rootLabel);
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

/** The fan chart's "Increase depth" button firing fetchPersonExpansion once
 * per boundary wedge was an N+1 round trip -- dozens of tiny GETs at once,
 * each paying full request latency, with the browser's own per-origin
 * connection cap serializing most of them anyway. One `IsLessThanNth
 * GenerationAncestorOf(id, 2)` clause per person, OR'd together in a single
 * rules query (same shape fetchTreeData's own ancestor+descendant OR
 * already uses, just many clauses instead of two), gets the same union of
 * "each of these people plus their immediate parents" in one request. */
export async function fetchBatchAncestorExpansion(token: string, grampsIds: string[]): Promise<TreePersonRaw[]> {
  if (grampsIds.length === 0) return [];
  const rules = {
    function: "or",
    rules: grampsIds.map((id) => ({ name: "IsLessThanNthGenerationAncestorOf", values: [id, 2] })),
  };
  const url = `${API_BASE}/api/people/?rules=${encodeURIComponent(JSON.stringify(rules))}&profile=self&extend=primary_parent_family,family_list`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const body = await res.json();
  if (Array.isArray(body)) return body as TreePersonRaw[];
  throw new Error(body?.error?.message ?? "Failed to load tree data");
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

/** A person's box thumbnail: their `media_list`'s first entry, cropped to
 * its rect (gramps-web-api's percentage-based
 * `/cropped/<x1>/<y1>/<x2>/<y2>/thumbnail/<size>` route, integers 0-100 --
 * same convention gramps-web's own charts/util.js `getImageUrl`/
 * `normalizeRect` use) when the reference has one, else the plain
 * `/thumbnail/<size>` route. Null when the person has no media at all. */
export function personThumbnailUrl(token: string, person: TreePersonRaw, size: number): string | null {
  const ref = person.media_list?.[0];
  if (!ref?.ref) return null;
  return mediaThumbnailUrl(ref.ref, size, token, { rect: ref.rect, square: true });
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
