import { describe, expect, it } from "vitest";

import { gqlFilterPresets } from "../../data/gqlFilterPresets";
import { FilterCombineError } from "../goqlFilterCombiner";
import {
  addConditionRow,
  addGroup,
  combineFilterTree,
  countConditions,
  createConditionRow,
  createEmptyTree,
  createGroup,
  moveNode,
  removeNode,
  setConnector,
  toggleNegate,
  updateRowValues,
  type FilterGroup,
} from "../goqlFilterTree";

describe("combineFilterTree", () => {
  it("combines a flat AND group of two rows", () => {
    const tree = createEmptyTree("Person");
    tree.root.connector = "and";
    tree.root.children = [createConditionRow("females"), createConditionRow("has-media")];

    expect(combineFilterTree(tree, gqlFilterPresets)).toEqual({
      namespace: "Person",
      whereExpr: "((gender == Person.FEMALE) and (exists(media)))",
    });
  });

  it("negates a row inline, with no separate node needed", () => {
    const tree = createEmptyTree("Person");
    const row = createConditionRow("has-notes");
    row.negate = true;
    tree.root.children = [row];

    expect(combineFilterTree(tree, gqlFilterPresets).whereExpr).toBe("not ((exists(notes)))");
  });

  it("negates a whole group", () => {
    const tree = createEmptyTree("Person");
    const group = createGroup("or", [createConditionRow("males"), createConditionRow("females")]);
    group.negate = true;
    tree.root.children = [group];

    expect(combineFilterTree(tree, gqlFilterPresets).whereExpr).toBe(
      "not (((gender == Person.MALE) or (gender == Person.FEMALE)))",
    );
  });

  it("nests a sub-group to mix AND/OR", () => {
    const tree = createEmptyTree("Person");
    tree.root.connector = "and";
    tree.root.children = [
      createConditionRow("has-media"),
      createGroup("or", [createConditionRow("males"), createConditionRow("females")]),
    ];

    expect(combineFilterTree(tree, gqlFilterPresets).whereExpr).toBe(
      "((exists(media)) and ((gender == Person.MALE) or (gender == Person.FEMALE)))",
    );
  });

  it("fills in a parameterized row's values", () => {
    const tree = createEmptyTree("Person");
    tree.root.children = [
      createConditionRow("birth-year-between", { startYear: "1900", endYear: "1950" }),
    ];

    expect(combineFilterTree(tree, gqlFilterPresets).whereExpr).toBe(
      "(Date('Jan 1, 1900') <= birth.date.sortval <= Date('Dec 31, 1950'))",
    );
  });

  it("throws on a stale/unknown preset id", () => {
    const tree = createEmptyTree("Person");
    tree.root.children = [createConditionRow("no-such-preset")];

    expect(() => combineFilterTree(tree, gqlFilterPresets)).toThrow(FilterCombineError);
  });

  it("still rejects a namespace mismatch reached through the tree", () => {
    const tree = createEmptyTree("Person");
    tree.root.children = [
      createConditionRow("females"),
      createConditionRow("families-incomplete-events"),
    ];

    expect(() => combineFilterTree(tree, gqlFilterPresets)).toThrow(FilterCombineError);
  });
});

describe("tree mutation helpers", () => {
  it("addConditionRow appends to the root group", () => {
    const tree = createEmptyTree("Person");
    const next = addConditionRow(tree, tree.root.id, "females");

    expect(next.root.children).toHaveLength(1);
    expect((next.root.children[0] as any).presetId).toBe("females");
    expect(tree.root.children).toHaveLength(0); // original untouched
  });

  it("addConditionRow appends to a nested group by id", () => {
    const tree = createEmptyTree("Person");
    const nested = createGroup("or");
    tree.root.children = [nested];

    const next = addConditionRow(tree, nested.id, "males");

    const nextNested = next.root.children[0] as FilterGroup;
    expect(nextNested.children).toHaveLength(1);
    expect((nextNested.children[0] as any).presetId).toBe("males");
  });

  it("addConditionRow is a no-op when the target id doesn't exist", () => {
    const tree = createEmptyTree("Person");
    const next = addConditionRow(tree, "no-such-id", "females");
    expect(next.root.children).toHaveLength(0);
  });

  it("addGroup nests a new empty AND-group under the target", () => {
    const tree = createEmptyTree("Person");
    const next = addGroup(tree, tree.root.id);

    expect(next.root.children).toHaveLength(1);
    const child = next.root.children[0] as FilterGroup;
    expect(child.kind).toBe("group");
    expect(child.connector).toBe("and");
    expect(child.children).toHaveLength(0);
  });

  it("removeNode drops a row from wherever it sits, including nested", () => {
    const tree = createEmptyTree("Person");
    const row = createConditionRow("females");
    const nested = createGroup("or", [row, createConditionRow("males")]);
    tree.root.children = [nested];

    const next = removeNode(tree, row.id);

    const nextNested = next.root.children[0] as FilterGroup;
    expect(nextNested.children).toHaveLength(1);
    expect((nextNested.children[0] as any).presetId).toBe("males");
  });

  it("removeNode removes a whole group, children included", () => {
    const tree = createEmptyTree("Person");
    const nested = createGroup("or", [createConditionRow("females")]);
    tree.root.children = [createConditionRow("males"), nested];

    const next = removeNode(tree, nested.id);

    expect(next.root.children).toHaveLength(1);
    expect((next.root.children[0] as any).presetId).toBe("males");
  });

  it("removeNode on the root id is a no-op -- a tree always keeps its root", () => {
    const tree = createEmptyTree("Person");
    tree.root.children = [createConditionRow("females")];
    const next = removeNode(tree, tree.root.id);
    expect(next).toBe(tree);
  });

  it("toggleNegate flips a row's own flag without touching siblings", () => {
    const tree = createEmptyTree("Person");
    const row = createConditionRow("females");
    tree.root.children = [row, createConditionRow("males")];

    const next = toggleNegate(tree, row.id);

    expect((next.root.children[0] as any).negate).toBe(true);
    expect((next.root.children[1] as any).negate).toBe(false);
    expect(row.negate).toBe(false); // original untouched
  });

  it("toggleNegate works on a nested group and on the root itself", () => {
    const tree = createEmptyTree("Person");
    const nested = createGroup("or", [createConditionRow("females")]);
    tree.root.children = [nested];

    const withNestedNegated = toggleNegate(tree, nested.id);
    expect((withNestedNegated.root.children[0] as FilterGroup).negate).toBe(true);

    const withRootNegated = toggleNegate(tree, tree.root.id);
    expect(withRootNegated.root.negate).toBe(true);
  });

  it("setConnector changes a group's AND/OR and is a no-op on a row id", () => {
    const tree = createEmptyTree("Person");
    const row = createConditionRow("females");
    tree.root.children = [row];

    const next = setConnector(tree, tree.root.id, "or");
    expect(next.root.connector).toBe("or");

    const noop = setConnector(tree, row.id, "or");
    expect(noop.root.children).toEqual(tree.root.children);
  });

  it("updateRowValues replaces a row's param values wholesale", () => {
    const tree = createEmptyTree("Person");
    const row = createConditionRow("birth-year-between", { startYear: "", endYear: "" });
    tree.root.children = [row];

    const next = updateRowValues(tree, row.id, { startYear: "1900", endYear: "1950" });

    expect((next.root.children[0] as any).values).toEqual({ startYear: "1900", endYear: "1950" });
  });

  it("moveNode reorders within the same parent, and no-ops at either edge", () => {
    const tree = createEmptyTree("Person");
    const a = createConditionRow("females");
    const b = createConditionRow("males");
    const c = createConditionRow("has-media");
    tree.root.children = [a, b, c];

    const movedUp = moveNode(tree, b.id, "up");
    expect(movedUp.root.children.map((n) => n.id)).toEqual([b.id, a.id, c.id]);

    const noopAtTop = moveNode(tree, a.id, "up");
    expect(noopAtTop.root.children.map((n) => n.id)).toEqual([a.id, b.id, c.id]);

    const noopAtBottom = moveNode(tree, c.id, "down");
    expect(noopAtBottom.root.children.map((n) => n.id)).toEqual([a.id, b.id, c.id]);
  });

  it("moveNode only reorders within the node's own nested parent, never across groups", () => {
    const tree = createEmptyTree("Person");
    const inner1 = createConditionRow("females");
    const inner2 = createConditionRow("males");
    const nested = createGroup("or", [inner1, inner2]);
    const outer = createConditionRow("has-media");
    tree.root.children = [outer, nested];

    const next = moveNode(tree, inner2.id, "up");

    // outer/nested order at the root is untouched -- only inner1/inner2
    // swapped, inside `nested`.
    expect(next.root.children.map((n) => n.id)).toEqual([outer.id, nested.id]);
    const nextNested = next.root.children[1] as FilterGroup;
    expect(nextNested.children.map((n) => n.id)).toEqual([inner2.id, inner1.id]);
  });

  it("countConditions counts leaf rows recursively, ignoring group nodes themselves", () => {
    const tree = createEmptyTree("Person");
    const nested = createGroup("or", [createConditionRow("females"), createConditionRow("males")]);
    tree.root.children = [createConditionRow("has-media"), nested];

    expect(countConditions(tree)).toBe(3);
  });

  it("countConditions is 0 for an empty tree", () => {
    expect(countConditions(createEmptyTree("Person"))).toBe(0);
  });
});
