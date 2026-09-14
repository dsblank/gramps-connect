/**
 * Editable UI-side tree for the filter editor -- what the picker/editor
 * component actually reads and mutates (add/remove/reorder rows, toggle
 * NOT, fill in a param). Deliberately a different shape from
 * ./goqlFilterCombiner's `FilterNode`: rows here hold a `presetId` string
 * (serializable, stable across a catalog reload) instead of an embedded
 * `GqlFilterPreset` object, and every node -- row or group -- carries its
 * own `negate` flag so negating one condition is a checkbox on that row,
 * never a separate filter the way Gramps' desktop Custom Filter Editor
 * requires (see project_goql_filter_system_design memory).
 *
 * `treeToFilterNode`/`combineFilterTree` are the bridge into the existing
 * compiler -- the editor works in this shape, then hands off to
 * `combineFilters` to get one `where_expr` string.
 */

import type { GqlFilterNamespace, GqlFilterPreset } from "../data/gqlFilterPresets";
import { combineFilters, FilterCombineError, type CombinedFilter, type FilterNode } from "./goqlFilterCombiner";

export type FilterConnector = "and" | "or";

export interface FilterConditionRow {
  kind: "condition";
  /** Stable across edits -- React key, and the target of the add/remove/
   * move/toggle helpers below (addConditionRow/addGroup/removeNode/
   * toggleNegate/setConnector/updateRowValues/moveNode), all of which
   * locate a node by this id rather than by array position. */
  id: string;
  /** Looked up in the catalog at render/compile time -- see
   * `treeToFilterNode`. Never an embedded preset object, so the tree stays
   * plain JSON (savable as a Custom Filter later without dragging the
   * whole catalog along with it). */
  presetId: string;
  /** Inline NOT toggle -- the one thing this data model exists to make
   * cheap. Negating a row is flipping this, not creating another node. */
  negate: boolean;
  /** Keyed by each of the preset's `params[].name`; absent/empty until the
   * user fills the row in. Left unset (not defaulted) so the editor can
   * tell "not filled in yet" apart from "filled in as empty string." */
  values?: Record<string, string>;
}

export interface FilterGroup {
  kind: "group";
  id: string;
  /** One connector for every direct child -- mixed AND/OR comes only from
   * nesting a sub-group, matching how `FilterNode`'s `and`/`or` already
   * take a flat children array. Keeps each group's own control (a single
   * AND/OR toggle) unambiguous instead of Gramps' one-mode-for-the-whole-
   * filter picker. */
  connector: FilterConnector;
  /** Inline NOT toggle on the group as a whole (e.g. "NOT (any of these
   * three)"). */
  negate: boolean;
  children: FilterTreeNode[];
}

export type FilterTreeNode = FilterConditionRow | FilterGroup;

export interface FilterTree {
  /** Fixed for the life of the tree -- the picker only offers presets from
   * this namespace, so a mismatch can't be constructed through the UI in
   * the first place. `treeToFilterNode`/`combineFilters` still re-check it
   * (see goqlFilterCombiner.ts), since this field is just the editor's own
   * declared contract, not itself a proof. */
  namespace: GqlFilterNamespace;
  /** Always a group, even for a single condition -- gives the editor one
   * consistent root to render/mutate rather than special-casing "the tree
   * is currently just one bare row." */
  root: FilterGroup;
}

export function createConditionRow(
  presetId: string,
  values?: Record<string, string>,
): FilterConditionRow {
  return { kind: "condition", id: crypto.randomUUID(), presetId, negate: false, values };
}

export function createGroup(
  connector: FilterConnector = "and",
  children: FilterTreeNode[] = [],
): FilterGroup {
  return { kind: "group", id: crypto.randomUUID(), connector, negate: false, children };
}

export function createEmptyTree(namespace: GqlFilterNamespace): FilterTree {
  return { namespace, root: createGroup("and", []) };
}

/** Finds `nodeId` anywhere in `group`'s subtree (a direct child or nested
 * arbitrarily deep) and replaces it with `updater(node)`, or drops it from
 * its parent's `children` if `updater` returns `null` -- the one recursive
 * primitive every by-id mutation below is built on. Returns `group`
 * itself (same reference) when `nodeId` isn't found anywhere in it, so a
 * caller can tell "nothing changed" without a separate "found" flag.
 * Never called with `nodeId` naming `group` itself -- the root is always
 * handled directly by each exported helper below, since replacing/removing
 * *it* would leave a `FilterTree` with no root at all. */
function mapChildren(
  group: FilterGroup,
  nodeId: string,
  updater: (node: FilterTreeNode) => FilterTreeNode | null,
): FilterGroup {
  let changed = false;
  const children: FilterTreeNode[] = [];
  for (const child of group.children) {
    if (child.id === nodeId) {
      changed = true;
      const replaced = updater(child);
      if (replaced !== null) children.push(replaced);
      continue;
    }
    if (child.kind === "group") {
      const mapped = mapChildren(child, nodeId, updater);
      if (mapped !== child) changed = true;
      children.push(mapped);
    } else {
      children.push(child);
    }
  }
  return changed ? { ...group, children } : group;
}

/** Flips `nodeId`'s own `negate` flag -- root included, the group as a
 * whole can be negated too. The one operation this whole data model exists
 * to make cheap: no second node, no separate saved filter, just this. */
export function toggleNegate(tree: FilterTree, nodeId: string): FilterTree {
  if (tree.root.id === nodeId) {
    return { ...tree, root: { ...tree.root, negate: !tree.root.negate } };
  }
  return { ...tree, root: mapChildren(tree.root, nodeId, (n) => ({ ...n, negate: !n.negate })) };
}

/** Changes `groupId`'s AND/OR connector -- a no-op if `groupId` doesn't
 * name a group (defensive: the UI only ever offers this control on a
 * group's own row, so this guard should never actually trigger). */
export function setConnector(tree: FilterTree, groupId: string, connector: FilterConnector): FilterTree {
  if (tree.root.id === groupId) {
    return { ...tree, root: { ...tree.root, connector } };
  }
  return {
    ...tree,
    root: mapChildren(tree.root, groupId, (n) => (n.kind === "group" ? { ...n, connector } : n)),
  };
}

/** Replaces `rowId`'s param values wholesale (the editor always has the
 * complete, current set of that row's inputs on hand when one changes) --
 * a no-op if `rowId` doesn't name a condition row. */
export function updateRowValues(tree: FilterTree, rowId: string, values: Record<string, string>): FilterTree {
  return {
    ...tree,
    root: mapChildren(tree.root, rowId, (n) => (n.kind === "condition" ? { ...n, values } : n)),
  };
}

/** Removes `nodeId` (a row or a whole group, children included) from
 * wherever it sits in the tree. A no-op for the root itself -- a
 * `FilterTree` always has a root group, so there's nothing sensible to
 * remove it *to*; the editor should offer no remove control on the root
 * row in the first place. */
export function removeNode(tree: FilterTree, nodeId: string): FilterTree {
  if (tree.root.id === nodeId) return tree;
  return { ...tree, root: mapChildren(tree.root, nodeId, () => null) };
}

/** Appends a new condition row for `presetId` to `groupId`'s children --
 * a no-op if `groupId` doesn't name a group. */
export function addConditionRow(tree: FilterTree, groupId: string, presetId: string): FilterTree {
  const row = createConditionRow(presetId);
  if (tree.root.id === groupId) {
    return { ...tree, root: { ...tree.root, children: [...tree.root.children, row] } };
  }
  return {
    ...tree,
    root: mapChildren(tree.root, groupId, (n) => (n.kind === "group" ? { ...n, children: [...n.children, row] } : n)),
  };
}

/** Nests a new, empty AND-group under `groupId` -- the only way to mix
 * AND and OR: a group's own connector applies uniformly to its direct
 * children, so combining differently requires a sub-group with its own
 * connector. A no-op if `groupId` doesn't name a group. */
export function addGroup(tree: FilterTree, groupId: string): FilterTree {
  const group = createGroup();
  if (tree.root.id === groupId) {
    return { ...tree, root: { ...tree.root, children: [...tree.root.children, group] } };
  }
  return {
    ...tree,
    root: mapChildren(tree.root, groupId, (n) => (n.kind === "group" ? { ...n, children: [...n.children, group] } : n)),
  };
}

/** Finds `nodeId`'s *direct* parent (unlike `mapChildren`, which finds the
 * node itself at any depth) and swaps it with its adjacent sibling --
 * moving a node only ever reorders within its own parent's `children`,
 * never across groups. A no-op at either end of the array (nothing to
 * swap with) or if `nodeId` isn't found. */
function moveWithinParent(group: FilterGroup, nodeId: string, direction: "up" | "down"): FilterGroup {
  const index = group.children.findIndex((c) => c.id === nodeId);
  if (index !== -1) {
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= group.children.length) return group;
    const children = [...group.children];
    [children[index], children[swapWith]] = [children[swapWith], children[index]];
    return { ...group, children };
  }
  let changed = false;
  const children = group.children.map((child) => {
    if (child.kind !== "group") return child;
    const mapped = moveWithinParent(child, nodeId, direction);
    if (mapped !== child) changed = true;
    return mapped;
  });
  return changed ? { ...group, children } : group;
}

/** Reorders `nodeId` one slot earlier/later among its own parent's
 * children -- root is never a valid target (it has no parent/siblings to
 * move among), so the editor should offer no move controls on the root
 * row, same as removeNode(). */
export function moveNode(tree: FilterTree, nodeId: string, direction: "up" | "down"): FilterTree {
  return { ...tree, root: moveWithinParent(tree.root, nodeId, direction) };
}

/** Counts every condition row in the tree, recursively -- for the
 * "Filters (N)" trigger badge (ListHeader.tsx), which needs a single
 * number regardless of how deeply the presets it's counting are nested. */
export function countConditions(tree: FilterTree): number {
  const countIn = (node: FilterTreeNode): number =>
    node.kind === "condition" ? 1 : node.children.reduce((sum, child) => sum + countIn(child), 0);
  return countIn(tree.root);
}

/** Resolves each row's `presetId` and lowers the UI tree into the
 * `FilterNode` shape `combineFilters` compiles -- wrapping in `not` for
 * any node with `negate: true` along the way. Throws `FilterCombineError`
 * for a `presetId` that isn't in `presetsById` (a stale reference after a
 * catalog change, most likely), the same error type `combineFilters`
 * itself throws for everything else, so a caller only needs one catch.
 */
export function treeToFilterNode(
  node: FilterTreeNode,
  presetsById: ReadonlyMap<string, GqlFilterPreset>,
): FilterNode {
  if (node.kind === "condition") {
    const preset = presetsById.get(node.presetId);
    if (!preset) {
      throw new FilterCombineError(`unknown filter preset id "${node.presetId}"`);
    }
    const leaf: FilterNode = { kind: "preset", preset, values: node.values };
    return node.negate ? { kind: "not", child: leaf } : leaf;
  }
  const group: FilterNode = {
    kind: node.connector,
    children: node.children.map((child) => treeToFilterNode(child, presetsById)),
  };
  return node.negate ? { kind: "not", child: group } : group;
}

/** Convenience wrapper: catalog array in, compiled `where_expr` out. */
export function combineFilterTree(
  tree: FilterTree,
  presets: readonly GqlFilterPreset[],
): CombinedFilter {
  const presetsById = new Map(presets.map((p) => [p.id, p] as const));
  return combineFilters(treeToFilterNode(tree.root, presetsById));
}
