// Angular-geometry regression tests for the ancestor fan chart's "size by
// lifespan" mode. This math went through several visibly-broken iterations
// (a wedge shifted off its true center, deep generations rendering outside
// their own parent, sibling gaps ballooning with depth) that each looked
// fine in isolation and only showed up as wrong once a real multi-
// generation family tree was screenshotted. Asserting the actual geometric
// invariants directly -- containment, exact sibling adjacency, centering --
// catches that class of bug without needing a screenshot round-trip.
import { describe, expect, it } from "vitest";
import { collectWedges, edgeInset, MIN_RENDERED_WIDTH_RAD, PER_GEN_INSET_RAD, type Wedge } from "../charts/fanChart";
import type { TreeNode } from "../store/treeData";

/** A complete ahnentafel binary tree `depth` generations deep, every node a
 * distinctly-handled real person -- collectWedges only branches on whether
 * `node.children` is set at all, so placeholder/no-record wedges (which
 * skip the recursion entirely) aren't a fourth geometry case, just an
 * early exit already covered by "a wedge with no children stops here". */
function fullTree(depth: number, handle = "1"): TreeNode {
  if (depth === 0) return { person: { handle, gramps_id: handle, gender: 0 } };
  return {
    person: { handle, gramps_id: handle, gender: 0 },
    children: [fullTree(depth - 1, `${handle}f`), fullTree(depth - 1, `${handle}m`)],
  };
}

/** Radius is irrelevant to every test in this file -- a fixed 0..1 band
 * keeps collectWedges' own signature satisfied without pulling in
 * nodeRadii/date parsing at all. */
const stubRadii = (_node: TreeNode | null, fallbackInnerR: number) => ({
  innerR: fallbackInnerR,
  outerR: fallbackInnerR + 1,
});

function collect(depth: number): Wedge[] {
  const out: Wedge[] = [];
  collectWedges(fullTree(depth), 0, -Math.PI / 2, Math.PI / 2, "none", 0, stubRadii, true, out);
  return out;
}

const EPS = 1e-9;

describe("edgeInset", () => {
  it("returns the flat per-generation amount when the wedge has room for it", () => {
    expect(edgeInset(Math.PI / 2)).toBeCloseTo(PER_GEN_INSET_RAD, 12);
  });

  it("clamps to the wedge's own width minus the min-rendered-width floor once it's too narrow", () => {
    const narrow = MIN_RENDERED_WIDTH_RAD + 0.001;
    expect(edgeInset(narrow)).toBeCloseTo(0.001, 12);
  });

  it("never goes negative for a wedge narrower than the floor itself", () => {
    expect(edgeInset(MIN_RENDERED_WIDTH_RAD / 2)).toBe(0);
  });

  it("never goes negative for a zero-width wedge", () => {
    expect(edgeInset(0)).toBe(0);
  });
});

describe("collectWedges angular geometry", () => {
  it("gives the root the full, uninset dome", () => {
    const [root] = collect(3);
    expect(root.depth).toBe(0);
    expect(root.drawA0).toBeCloseTo(-Math.PI / 2, 12);
    expect(root.drawA1).toBeCloseTo(Math.PI / 2, 12);
  });

  it("never inverts a wedge (drawA1 > drawA0) even many generations deep", () => {
    for (const w of collect(9)) {
      expect(w.drawA1).toBeGreaterThan(w.drawA0);
    }
  });

  it("keeps every non-root wedge strictly inside its own parent's rendered bounds", () => {
    const wedges = collect(6);
    const byHandle = new Map(wedges.map((w) => [w.node!.person!.handle, w]));
    for (const w of wedges) {
      if (w.depth === 0) continue;
      const parentHandle = w.node!.person!.handle.slice(0, -1);
      const parent = byHandle.get(parentHandle)!;
      expect(w.drawA0).toBeGreaterThanOrEqual(parent.drawA0 - EPS);
      expect(w.drawA1).toBeLessThanOrEqual(parent.drawA1 + EPS);
      // Strict on at least the inherited edge -- the whole point of
      // edgeInset existing at all (a screenshot showed deep generations
      // rendering flush with, or entirely outside, their own parent).
      const isFather = w.node!.person!.handle.endsWith("f");
      if (isFather) expect(w.drawA0).toBeGreaterThan(parent.drawA0 + EPS);
      else expect(w.drawA1).toBeLessThan(parent.drawA1 - EPS);
    }
  });

  it("splits every parent at its own rendered center, not its raw center", () => {
    const wedges = collect(6);
    const byHandle = new Map(wedges.map((w) => [w.node!.person!.handle, w]));
    for (const w of wedges) {
      if (!w.node?.children) continue;
      const father = byHandle.get(`${w.node.person!.handle}f`)!;
      const mother = byHandle.get(`${w.node.person!.handle}m`)!;
      const renderedCenter = (w.drawA0 + w.drawA1) / 2;
      expect(father.drawA1).toBeCloseTo(renderedCenter, 12);
      expect(mother.drawA0).toBeCloseTo(renderedCenter, 12);
    }
  });

  it("gives two siblings the exact same shared boundary -- zero gap between them", () => {
    const wedges = collect(6);
    const byHandle = new Map(wedges.map((w) => [w.node!.person!.handle, w]));
    for (const w of wedges) {
      if (!w.node?.children) continue;
      const father = byHandle.get(`${w.node.person!.handle}f`)!;
      const mother = byHandle.get(`${w.node.person!.handle}m`)!;
      expect(father.drawA1).toBeCloseTo(mother.drawA0, 12);
    }
  });

  it("keeps a father's own raw width equal to a mother's (symmetric halving every generation)", () => {
    const wedges = collect(6);
    const byHandle = new Map(wedges.map((w) => [w.node!.person!.handle, w]));
    for (const w of wedges) {
      if (!w.node?.children) continue;
      const father = byHandle.get(`${w.node.person!.handle}f`)!;
      const mother = byHandle.get(`${w.node.person!.handle}m`)!;
      expect(father.a1 - father.a0).toBeCloseTo(mother.a1 - mother.a0, 12);
    }
  });

  it("draws flush edge-to-edge sectors (drawA0/drawA1 equal a0/a1) when applyInset is false", () => {
    const out: Wedge[] = [];
    collectWedges(fullTree(6), 0, -Math.PI / 2, Math.PI / 2, "none", 0, stubRadii, false, out);
    for (const w of out) {
      expect(w.drawA0).toBe(w.a0);
      expect(w.drawA1).toBe(w.a1);
    }
  });
});
