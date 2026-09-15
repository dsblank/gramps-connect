/**
 * Human-readable summary of a FilterTree -- "Females AND (Widowed OR
 * Divorced)", using each rule's own preset *label*, not its compiled
 * GOQL (that's formatWhereExpr.ts's job, for the dialog's own read-only
 * preview). For ListHeader.tsx's own trigger row, so someone can tell
 * what's active without opening the Filters dialog at all.
 *
 * Walks the tree directly (structured data, unlike formatWhereExpr.ts's
 * string-scanning over an already-compiled expression) -- much simpler,
 * and naturally correct for nesting/negation since it's reading the same
 * shape goqlFilterTree.ts's own treeToFilterNode() does.
 */
import type { GqlFilterPreset } from "../data/gqlFilterPresets";
import type { FilterRuleGroup, FilterRuleRow, FilterTree, FilterTreeNode } from "./goqlFilterTree";

/** Same "surfaced, not silently dropped" fallback RowView.tsx's own stale-
 * preset-id case uses. */
const UNKNOWN_LABEL = "Unknown rule";

function ruleSummary(row: FilterRuleRow, presetsById: ReadonlyMap<string, GqlFilterPreset>): string {
  const preset = presetsById.get(row.presetId);
  if (!preset) return UNKNOWN_LABEL;
  const params = preset.params ?? [];
  // Only appends filled-in values, and only when *every* param has one --
  // a still-being-edited row with some params blank just shows the bare
  // label, same "not ready to compile yet" state combineFilterTree()
  // itself would reject rather than half-render.
  const values = params.length > 0 && params.every((p) => row.values?.[p.name])
    ? ` ${params.map((p) => row.values![p.name]).join(" and ")}`
    : "";
  const text = `${preset.label}${values}`;
  return row.negate ? `NOT ${text}` : text;
}

function ruleGroupSummary(group: FilterRuleGroup, presetsById: ReadonlyMap<string, GqlFilterPreset>): string {
  const parts = group.children.map((child) => nodeSummary(child, presetsById)).filter((s) => s.length > 0);
  if (parts.length === 0) return "";
  const joiner = group.connector === "and" ? " AND " : " OR ";
  const joined = parts.length === 1 ? parts[0] : `(${parts.join(joiner)})`;
  return group.negate ? `NOT ${joined}` : joined;
}

/** Checks `"rule-group"` explicitly rather than assuming "anything that
 * isn't a rule must be one" -- this is a best-effort display summary over
 * a tree that round-trips through Saved Filter Media JSON
 * (savedFilterMedia.ts), so a node whose `kind` predates a future rename
 * (or is otherwise unrecognized) contributes nothing rather than crashing
 * on a `.children` that isn't there, same "surfaced as empty, never
 * thrown" posture UNKNOWN_LABEL above already takes for a missing
 * preset. */
function nodeSummary(node: FilterTreeNode, presetsById: ReadonlyMap<string, GqlFilterPreset>): string {
  if (node.kind === "rule") return ruleSummary(node, presetsById);
  if (node.kind === "rule-group") return ruleGroupSummary(node, presetsById);
  return "";
}

/** `""` for an empty tree (root rule group with no children) -- callers
 * should treat that the same as "nothing to show", same as
 * `countRules(tree) === 0`. */
export function summarizeFilterTree(tree: FilterTree, presets: readonly GqlFilterPreset[]): string {
  const presetsById = new Map(presets.map((p) => [p.id, p] as const));
  return ruleGroupSummary(tree.root, presetsById);
}
