import { describe, expect, it } from "vitest";

import { computeClusterSiblings, groupSiblingsByParents, type TreePersonRaw } from "../treeData";

/** A great-grandfather (F) married three times: full siblings with wife 1
 * (M1: A, B), a half-sibling (father's side) with wife 2 (M2: C), and --
 * the case that used to be mislabeled, and the one whose *reverse* direction
 * used to be silently dropped entirely -- wife 3 (M3) was a widow whose own
 * child (D) from her first marriage (to X, fam0) came into the F marriage
 * (fam3) as F's stepchild, not his by birth. D's own *primary* parent
 * family is fam0 (their birth family), not fam3 -- exactly the case where
 * relying on primary_parent_family alone used to fail to ever discover F
 * (or F's other two marriages) as one of D's own parents at all. */
function buildFixture(): TreePersonRaw[] {
  const fam0 = { handle: "fam0", father_handle: "X", mother_handle: "M3", child_ref_list: [
    { ref: "D", frel: "Birth", mrel: "Birth" },
  ] };
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
  const father: TreePersonRaw = { handle: "F", gramps_id: "F", gender: 1, extended: { families: [fam1, fam2, fam3] } };
  const mother1: TreePersonRaw = { handle: "M1", gramps_id: "M1", gender: 0, extended: { families: [fam1] } };
  const mother2: TreePersonRaw = { handle: "M2", gramps_id: "M2", gender: 0, extended: { families: [fam2] } };
  const mother3: TreePersonRaw = { handle: "M3", gramps_id: "M3", gender: 0, extended: { families: [fam0, fam3] } };
  const firstHusband: TreePersonRaw = { handle: "X", gramps_id: "X", gender: 1, extended: { families: [fam0] } };
  const a: TreePersonRaw = {
    handle: "A", gramps_id: "A", gender: 0,
    extended: { primary_parent_family: { father_handle: "F", mother_handle: "M1" }, parent_family_list: [fam1] },
  };
  const b: TreePersonRaw = {
    handle: "B", gramps_id: "B", gender: 0,
    extended: { primary_parent_family: { father_handle: "F", mother_handle: "M1" }, parent_family_list: [fam1] },
  };
  const c: TreePersonRaw = {
    handle: "C", gramps_id: "C", gender: 0,
    extended: { primary_parent_family: { father_handle: "F", mother_handle: "M2" }, parent_family_list: [fam2] },
  };
  const d: TreePersonRaw = {
    handle: "D", gramps_id: "D", gender: 0,
    extended: { primary_parent_family: { father_handle: "X", mother_handle: "M3" }, parent_family_list: [fam0, fam3] },
  };
  return [father, mother1, mother2, mother3, firstHusband, a, b, c, d];
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

  // The reverse direction: centering on D (whose *primary* parent family is
  // fam0, D's birth family with X -- not fam3, the step family with F) must
  // still discover F's other two marriages (fam1, fam2) as step-siblings,
  // the same way centering on A discovers D as one. Before this fix, D's
  // own cluster never looked at F at all, because F was never one of D's
  // "primary" two parents.
  it("discovers the father's birth children as step-siblings when centered on the step-child instead", () => {
    const data = buildFixture();
    const siblings = computeClusterSiblings(data, data.find((p) => p.handle === "D")!);
    const a = siblings.find((s) => s.person.handle === "A");
    const b = siblings.find((s) => s.person.handle === "B");
    const c = siblings.find((s) => s.person.handle === "C");
    expect(a?.relation).toBe("step");
    expect(b?.relation).toBe("step");
    expect(c?.relation).toBe("step");
  });

  it("keeps the step-child's own anchor entry as full regardless of direction", () => {
    const data = buildFixture();
    const siblings = computeClusterSiblings(data, data.find((p) => p.handle === "D")!);
    const d = siblings.find((s) => s.person.handle === "D");
    expect(d?.isAnchor).toBe(true);
    expect(d?.relation).toBe("full");
  });
});
