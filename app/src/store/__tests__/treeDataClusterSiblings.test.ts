import { describe, expect, it } from "vitest";

import { computeClusterSiblings, groupSiblingsByParents, type TreePersonRaw } from "../treeData";

/** A great-grandfather (F) married three times: full siblings with wife 1
 * (M1), a half-sibling (father's side) with wife 2 (M2), and -- the case
 * that used to be mislabeled -- wife 3 (M3) was a widow whose own children
 * (D) came into the marriage as F's stepchildren, not his by birth. */
function buildFixture(): TreePersonRaw[] {
  const fam1 = { handle: "fam1", father_handle: "F", mother_handle: "M1", child_ref_list: [
    { ref: "A", frel: "Birth", mrel: "Birth" },
    { ref: "B", frel: "Birth", mrel: "Birth" },
  ] };
  const fam2 = { handle: "fam2", father_handle: "F", mother_handle: "M2", child_ref_list: [
    { ref: "C", frel: "Birth", mrel: "Birth" },
  ] };
  const fam3 = { handle: "fam3", father_handle: "F", mother_handle: "M3", child_ref_list: [
    { ref: "D", frel: "Stepchild", mrel: "Birth" },
  ] };
  const father: TreePersonRaw = {
    handle: "F", gramps_id: "F", gender: 1,
    extended: { families: [fam1, fam2, fam3] },
  };
  const mother1: TreePersonRaw = { handle: "M1", gramps_id: "M1", gender: 0, extended: { families: [fam1] } };
  const personFor = (handle: string): TreePersonRaw => ({
    handle, gramps_id: handle, gender: 0,
    extended: { primary_parent_family: { father_handle: "F", mother_handle: handle === "A" || handle === "B" ? "M1" : handle === "C" ? "M2" : "M3" } },
  });
  const anchor: TreePersonRaw = { ...personFor("A"), extended: { primary_parent_family: { father_handle: "F", mother_handle: "M1" } } };
  return [father, mother1, anchor, personFor("B"), personFor("C"), personFor("D")];
}

describe("computeClusterSiblings", () => {
  it("classifies a full sibling (same father and mother, both by birth) as full", () => {
    const data = buildFixture();
    const siblings = computeClusterSiblings(data, data.find((p) => p.handle === "A")!);
    const b = siblings.find((s) => s.person.handle === "B");
    expect(b?.relation).toBe("full");
  });

  it("classifies a father's-side sibling from a different mother, by birth, as half-father", () => {
    const data = buildFixture();
    const siblings = computeClusterSiblings(data, data.find((p) => p.handle === "A")!);
    const c = siblings.find((s) => s.person.handle === "C");
    expect(c?.relation).toBe("half-father");
  });

  it("classifies the third wife's own child (frel Stepchild to the shared father) as step, not half-father", () => {
    const data = buildFixture();
    const siblings = computeClusterSiblings(data, data.find((p) => p.handle === "A")!);
    const d = siblings.find((s) => s.person.handle === "D");
    expect(d?.relation).toBe("step");
  });

  it("still groups the step-sibling under their own shared-parents group, separate from the anchor's own", () => {
    const data = buildFixture();
    const siblings = computeClusterSiblings(data, data.find((p) => p.handle === "A")!);
    const groups = groupSiblingsByParents(siblings);
    const dGroup = groups.find((g) => g.siblings.some((s) => s.person.handle === "D"));
    expect(dGroup?.siblings.map((s) => s.person.handle)).toEqual(["D"]);
  });
});
