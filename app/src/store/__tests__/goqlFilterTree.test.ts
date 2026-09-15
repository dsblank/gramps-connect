import { describe, expect, it } from "vitest";

import { gqlFilterPresets } from "../../data/gqlFilterPresets";
import { FilterCombineError } from "../goqlFilterCombiner";
import {
  addRuleGroup,
  addRuleRow,
  combineFilterTree,
  countRules,
  createEmptyTree,
  createRuleGroup,
  createRuleRow,
  moveNode,
  removeNode,
  setConnector,
  toggleNegate,
  updateRowValues,
  type FilterRuleGroup,
} from "../goqlFilterTree";

describe("combineFilterTree", () => {
  it("combines a flat AND rule group of two rows", () => {
    const tree = createEmptyTree("Person");
    tree.root.connector = "and";
    tree.root.children = [createRuleRow("females"), createRuleRow("has-media")];

    expect(combineFilterTree(tree, gqlFilterPresets)).toEqual({
      namespace: "Person",
      whereExpr: "((gender == Person.FEMALE) and (exists(media)))",
    });
  });

  it("negates a rule inline, with no separate node needed", () => {
    const tree = createEmptyTree("Person");
    const row = createRuleRow("has-notes");
    row.negate = true;
    tree.root.children = [row];

    expect(combineFilterTree(tree, gqlFilterPresets).whereExpr).toBe("not ((exists(notes)))");
  });

  it("negates a whole rule group", () => {
    const tree = createEmptyTree("Person");
    const group = createRuleGroup("or", [createRuleRow("males"), createRuleRow("females")]);
    group.negate = true;
    tree.root.children = [group];

    expect(combineFilterTree(tree, gqlFilterPresets).whereExpr).toBe(
      "not (((gender == Person.MALE) or (gender == Person.FEMALE)))",
    );
  });

  it("nests a sub-rule-group to mix AND/OR", () => {
    const tree = createEmptyTree("Person");
    tree.root.connector = "and";
    tree.root.children = [
      createRuleRow("has-media"),
      createRuleGroup("or", [createRuleRow("males"), createRuleRow("females")]),
    ];

    expect(combineFilterTree(tree, gqlFilterPresets).whereExpr).toBe(
      "((exists(media)) and ((gender == Person.MALE) or (gender == Person.FEMALE)))",
    );
  });

  it("fills in a parameterized rule's values", () => {
    const tree = createEmptyTree("Person");
    tree.root.children = [
      createRuleRow("birth-year-between", { startYear: "1900", endYear: "1950" }),
    ];

    expect(combineFilterTree(tree, gqlFilterPresets).whereExpr).toBe(
      "(Date('Jan 1, 1900') <= birth.date.sortval <= Date('Dec 31, 1950'))",
    );
  });

  it("throws on a stale/unknown preset id", () => {
    const tree = createEmptyTree("Person");
    tree.root.children = [createRuleRow("no-such-preset")];

    expect(() => combineFilterTree(tree, gqlFilterPresets)).toThrow(FilterCombineError);
  });

  it("still rejects a namespace mismatch reached through the tree", () => {
    const tree = createEmptyTree("Person");
    tree.root.children = [
      createRuleRow("females"),
      createRuleRow("families-incomplete-events"),
    ];

    expect(() => combineFilterTree(tree, gqlFilterPresets)).toThrow(FilterCombineError);
  });
});

describe("tree mutation helpers", () => {
  it("addRuleRow appends to the root rule group", () => {
    const tree = createEmptyTree("Person");
    const next = addRuleRow(tree, tree.root.id, "females");

    expect(next.root.children).toHaveLength(1);
    expect((next.root.children[0] as any).presetId).toBe("females");
    expect(tree.root.children).toHaveLength(0); // original untouched
  });

  it("addRuleRow appends to a nested rule group by id", () => {
    const tree = createEmptyTree("Person");
    const nested = createRuleGroup("or");
    tree.root.children = [nested];

    const next = addRuleRow(tree, nested.id, "males");

    const nextNested = next.root.children[0] as FilterRuleGroup;
    expect(nextNested.children).toHaveLength(1);
    expect((nextNested.children[0] as any).presetId).toBe("males");
  });

  it("addRuleRow is a no-op when the target id doesn't exist", () => {
    const tree = createEmptyTree("Person");
    const next = addRuleRow(tree, "no-such-id", "females");
    expect(next.root.children).toHaveLength(0);
  });

  it("addRuleGroup nests a new empty AND-rule-group under the target", () => {
    const tree = createEmptyTree("Person");
    const next = addRuleGroup(tree, tree.root.id);

    expect(next.root.children).toHaveLength(1);
    const child = next.root.children[0] as FilterRuleGroup;
    expect(child.kind).toBe("rule-group");
    expect(child.connector).toBe("and");
    expect(child.children).toHaveLength(0);
  });

  it("removeNode drops a rule from wherever it sits, including nested", () => {
    const tree = createEmptyTree("Person");
    const row = createRuleRow("females");
    const nested = createRuleGroup("or", [row, createRuleRow("males")]);
    tree.root.children = [nested];

    const next = removeNode(tree, row.id);

    const nextNested = next.root.children[0] as FilterRuleGroup;
    expect(nextNested.children).toHaveLength(1);
    expect((nextNested.children[0] as any).presetId).toBe("males");
  });

  it("removeNode removes a whole rule group, children included", () => {
    const tree = createEmptyTree("Person");
    const nested = createRuleGroup("or", [createRuleRow("females")]);
    tree.root.children = [createRuleRow("males"), nested];

    const next = removeNode(tree, nested.id);

    expect(next.root.children).toHaveLength(1);
    expect((next.root.children[0] as any).presetId).toBe("males");
  });

  it("removeNode on the root id is a no-op -- a tree always keeps its root", () => {
    const tree = createEmptyTree("Person");
    tree.root.children = [createRuleRow("females")];
    const next = removeNode(tree, tree.root.id);
    expect(next).toBe(tree);
  });

  it("toggleNegate flips a rule's own flag without touching siblings", () => {
    const tree = createEmptyTree("Person");
    const row = createRuleRow("females");
    tree.root.children = [row, createRuleRow("males")];

    const next = toggleNegate(tree, row.id);

    expect((next.root.children[0] as any).negate).toBe(true);
    expect((next.root.children[1] as any).negate).toBe(false);
    expect(row.negate).toBe(false); // original untouched
  });

  it("toggleNegate works on a nested rule group and on the root itself", () => {
    const tree = createEmptyTree("Person");
    const nested = createRuleGroup("or", [createRuleRow("females")]);
    tree.root.children = [nested];

    const withNestedNegated = toggleNegate(tree, nested.id);
    expect((withNestedNegated.root.children[0] as FilterRuleGroup).negate).toBe(true);

    const withRootNegated = toggleNegate(tree, tree.root.id);
    expect(withRootNegated.root.negate).toBe(true);
  });

  it("setConnector changes a rule group's AND/OR and is a no-op on a rule id", () => {
    const tree = createEmptyTree("Person");
    const row = createRuleRow("females");
    tree.root.children = [row];

    const next = setConnector(tree, tree.root.id, "or");
    expect(next.root.connector).toBe("or");

    const noop = setConnector(tree, row.id, "or");
    expect(noop.root.children).toEqual(tree.root.children);
  });

  it("updateRowValues replaces a rule's param values wholesale", () => {
    const tree = createEmptyTree("Person");
    const row = createRuleRow("birth-year-between", { startYear: "", endYear: "" });
    tree.root.children = [row];

    const next = updateRowValues(tree, row.id, { startYear: "1900", endYear: "1950" });

    expect((next.root.children[0] as any).values).toEqual({ startYear: "1900", endYear: "1950" });
  });

  it("moveNode reorders within the same parent, and no-ops at either edge", () => {
    const tree = createEmptyTree("Person");
    const a = createRuleRow("females");
    const b = createRuleRow("males");
    const c = createRuleRow("has-media");
    tree.root.children = [a, b, c];

    const movedUp = moveNode(tree, b.id, "up");
    expect(movedUp.root.children.map((n) => n.id)).toEqual([b.id, a.id, c.id]);

    const noopAtTop = moveNode(tree, a.id, "up");
    expect(noopAtTop.root.children.map((n) => n.id)).toEqual([a.id, b.id, c.id]);

    const noopAtBottom = moveNode(tree, c.id, "down");
    expect(noopAtBottom.root.children.map((n) => n.id)).toEqual([a.id, b.id, c.id]);
  });

  it("moveNode only reorders within the node's own nested parent, never across rule groups", () => {
    const tree = createEmptyTree("Person");
    const inner1 = createRuleRow("females");
    const inner2 = createRuleRow("males");
    const nested = createRuleGroup("or", [inner1, inner2]);
    const outer = createRuleRow("has-media");
    tree.root.children = [outer, nested];

    const next = moveNode(tree, inner2.id, "up");

    // outer/nested order at the root is untouched -- only inner1/inner2
    // swapped, inside `nested`.
    expect(next.root.children.map((n) => n.id)).toEqual([outer.id, nested.id]);
    const nextNested = next.root.children[1] as FilterRuleGroup;
    expect(nextNested.children.map((n) => n.id)).toEqual([inner2.id, inner1.id]);
  });

  it("countRules counts leaf rows recursively, ignoring rule group nodes themselves", () => {
    const tree = createEmptyTree("Person");
    const nested = createRuleGroup("or", [createRuleRow("females"), createRuleRow("males")]);
    tree.root.children = [createRuleRow("has-media"), nested];

    expect(countRules(tree)).toBe(3);
  });

  it("countRules is 0 for an empty tree", () => {
    expect(countRules(createEmptyTree("Person"))).toBe(0);
  });

  it("countRules doesn't crash on a node with an old/unrecognized kind (e.g. a pre-rename \"condition\"/\"group\" tree loaded from a Saved Filter)", () => {
    const tree = createEmptyTree("Person");
    // Not a real FilterTreeNode -- simulates a tree persisted before a
    // future rename of the `kind` values, round-tripped back in via
    // fetchSavedFilters(). Cast through `any` since the real type no
    // longer allows this shape.
    tree.root.children = [{ kind: "condition", id: "stale", presetId: "females", negate: false } as any];
    expect(countRules(tree)).toBe(0);
  });
});
