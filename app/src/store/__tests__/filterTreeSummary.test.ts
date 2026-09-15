import { describe, expect, it } from "vitest";

import { gqlFilterPresets } from "../../data/gqlFilterPresets";
import { summarizeFilterTree } from "../filterTreeSummary";
import {
  addRuleRow, createEmptyTree, createRuleGroup, toggleNegate,
} from "../goqlFilterTree";

describe("summarizeFilterTree", () => {
  it("is empty for an empty tree", () => {
    expect(summarizeFilterTree(createEmptyTree("Person"), gqlFilterPresets)).toBe("");
  });

  it("shows a single rule with no connector/parens", () => {
    const empty = createEmptyTree("Person");
    const tree = addRuleRow(empty, empty.root.id, "females");
    expect(summarizeFilterTree(tree, gqlFilterPresets)).toBe("Females");
  });

  it("joins two rules in the root rule group with AND, no extra parens at the top", () => {
    let tree = createEmptyTree("Person");
    tree = addRuleRow(tree, tree.root.id, "females");
    tree = addRuleRow(tree, tree.root.id, "has-media");
    expect(summarizeFilterTree(tree, gqlFilterPresets)).toBe("(Females AND People with media)");
  });

  it("prefixes a negated rule with NOT", () => {
    let tree = createEmptyTree("Person");
    tree = addRuleRow(tree, tree.root.id, "males");
    const rowId = tree.root.children[0].id;
    tree = toggleNegate(tree, rowId);
    expect(summarizeFilterTree(tree, gqlFilterPresets)).toBe("NOT Males");
  });

  it("wraps a nested OR rule group and negates it as a whole", () => {
    let tree = createEmptyTree("Person");
    tree = addRuleRow(tree, tree.root.id, "females");
    const orGroup = createRuleGroup("or", []);
    tree = { ...tree, root: { ...tree.root, children: [...tree.root.children, orGroup] } };
    tree = addRuleRow(tree, orGroup.id, "has-media");
    tree = addRuleRow(tree, orGroup.id, "has-notes");
    tree = toggleNegate(tree, orGroup.id);
    expect(summarizeFilterTree(tree, gqlFilterPresets)).toBe(
      "(Females AND NOT (People with media OR People having notes))",
    );
  });

  it("labels a stale/unknown preset id as \"Unknown rule\" rather than throwing", () => {
    let tree = createEmptyTree("Person");
    tree = addRuleRow(tree, tree.root.id, "no-such-preset");
    expect(summarizeFilterTree(tree, gqlFilterPresets)).toBe("Unknown rule");
  });
});
