import { describe, expect, it } from "vitest";

import { buildDescendantTree, type TreePersonRaw } from "../treeData";

/** A person (P) with two children in one family: one by birth (Birth), one
 * adopted (Adopted) -- the case that used to reach the UI with no relation
 * data at all, since descendantNode read frel/mrel only to decide whether
 * to include a child (relaxed mode keeps everyone) and then discarded it. */
function buildFixture(): TreePersonRaw[] {
  const fam = {
    handle: "fam1", father_handle: "P", mother_handle: undefined,
    child_ref_list: [
      { ref: "BIRTH_CHILD", frel: "Birth" },
      { ref: "ADOPTED_CHILD", frel: "Adopted" },
    ],
  };
  const parent: TreePersonRaw = { handle: "P", gramps_id: "P", gender: 1, extended: { families: [fam] } };
  const birthChild: TreePersonRaw = { handle: "BIRTH_CHILD", gramps_id: "BIRTH_CHILD", gender: 0 };
  const adoptedChild: TreePersonRaw = { handle: "ADOPTED_CHILD", gramps_id: "ADOPTED_CHILD", gender: 0 };
  return [parent, birthChild, adoptedChild];
}

describe("buildDescendantTree", () => {
  it("carries each child's own frel/mrel onto the resulting TreeNode, in relaxed mode", () => {
    const data = buildFixture();
    const tree = buildDescendantTree(data, "P", 1, new Set(), new Set(), "all");
    const adopted = tree.children?.find((c) => c.person?.handle === "ADOPTED_CHILD");
    const birth = tree.children?.find((c) => c.person?.handle === "BIRTH_CHILD");
    expect(adopted?.frel).toBe("Adopted");
    expect(birth?.frel).toBe("Birth");
  });

  it("still drops non-Birth children outside relaxed mode (box-tree's own behavior, unchanged)", () => {
    const data = buildFixture();
    const tree = buildDescendantTree(data, "P", 1);
    expect(tree.children?.map((c) => c.person?.handle)).toEqual(["BIRTH_CHILD"]);
  });
});
