/**
 * Built-in saved filters: ready-made combinations of the built-in rules
 * (gqlFilterPresets.ts), shipped with the app so a new tree isn't empty
 * under "Built-in filters". They are never written to the tree. Editing
 * one saves an ordinary Saved Filter with the same `id`, which then takes
 * its place on that tree (store/builtinSavedFilters.ts).
 *
 * Rules: an `id` never changes once released (trees refer to it), rule
 * rows only use built-in preset ids, and a single plain rule isn't worth
 * a built-in -- it's already in "Choose a filter…" on its own. Names are
 * English and shown through t().
 */
import type { GqlFilterNamespace } from "./gqlFilterPresets";
import type { FilterTree, FilterTreeNode } from "../store/goqlFilterTree";

export interface BuiltinSavedFilter {
  id: string;
  name: string;
  namespace: GqlFilterNamespace;
  tree: FilterTree;
}

function rule(id: string, presetId: string, negate = false): FilterTreeNode {
  return { kind: "rule", id, presetId, negate };
}

function filter(
  id: string, name: string, namespace: GqlFilterNamespace,
  connector: "and" | "or", children: FilterTreeNode[],
): BuiltinSavedFilter {
  return {
    id, name, namespace,
    tree: { namespace, root: { kind: "rule-group", id: `${id}-root`, connector, negate: false, children } },
  };
}

export const BUILTIN_SAVED_FILTERS: readonly BuiltinSavedFilter[] = [
  filter("builtin-research-gaps", "Research gaps", "Person", "or", [
    rule("r1", "no-birth-date"),
    rule("r2", "missing-parents"),
    rule("r3", "has-sources", true),
  ]),
  filter("builtin-people-without-sources", "People without sources", "Person", "and", [
    rule("r1", "has-sources", true),
  ]),
  filter("builtin-incomplete-people", "Incomplete people", "Person", "or", [
    rule("r1", "incomplete-names"),
    rule("r2", "no-birth-date"),
    rule("r3", "incomplete-events"),
  ]),
  filter("builtin-families-without-sources", "Families without sources", "Family", "and", [
    rule("r1", "family-has-sources", true),
  ]),
  filter("builtin-events-without-sources", "Events without sources", "Event", "and", [
    rule("r1", "event-has-sources", true),
  ]),
];
