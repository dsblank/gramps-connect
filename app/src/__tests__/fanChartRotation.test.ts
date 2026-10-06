// @vitest-environment jsdom
// Rotation gesture behavior for the ancestor fan chart: Ctrl+drag rotates,
// Shift snaps to 15° steps, a release near upright lands exactly on 0°, and
// resetFanRotation animates back to 0° (the compass button in FanChart.tsx).
import { describe, expect, it } from "vitest";
import { renderFanChart, resetFanRotation } from "../charts/fanChart";
import type { TreeNode } from "../store/treeData";

const tree: TreeNode = {
  person: { handle: "1", gramps_id: "I1", gender: 0 },
  children: [
    { person: { handle: "2", gramps_id: "I2", gender: 1 } },
    { person: { handle: "3", gramps_id: "I3", gender: 0 } },
  ],
};

function render(initialRotation = 0) {
  const changes: number[] = [];
  const svg = renderFanChart(tree, {
    bboxWidth: 400,
    bboxHeight: 400,
    initialRotation,
    onRotationChange: (deg) => changes.push(deg),
    sizeByLifespan: false,
    colorScheme: "gen",
  });
  document.body.replaceChildren(svg);
  return { svg, changes };
}

/** Ctrl+drags around the root, from a point at `fromDeg` to one at `toDeg`
 * (screen angle, the same atan2 convention fanChart.ts's own angleAt uses).
 * Root sits at screen (0,0) here: the fit transform has no translate, and
 * jsdom's zero-sized bounding rect makes d3.pointer's coordinates the raw
 * clientX/clientY. */
function ctrlDrag(svg: SVGSVGElement, fromDeg: number, toDeg: number, shiftKey = false) {
  const at = (deg: number) => ({
    clientX: 100 * Math.cos((deg * Math.PI) / 180),
    clientY: 100 * Math.sin((deg * Math.PI) / 180),
  });
  svg.dispatchEvent(new MouseEvent("mousedown", { ...at(fromDeg), ctrlKey: true, button: 0, bubbles: true }));
  window.dispatchEvent(new MouseEvent("mousemove", { ...at(toDeg), ctrlKey: true, shiftKey }));
  window.dispatchEvent(new MouseEvent("mouseup", {}));
}

const rotationOf = (svg: SVGSVGElement) => Number(svg.getAttribute("data-fan-rotation"));

describe("fan chart rotation", () => {
  it("rotates freely by the dragged angle", () => {
    const { svg, changes } = render();
    ctrlDrag(svg, 0, 40);
    expect(rotationOf(svg)).toBeCloseTo(40, 6);
    expect(changes.at(-1)).toBeCloseTo(40, 6);
  });

  it("snaps a release within a few degrees of upright to exactly 0°", () => {
    const { svg } = render();
    ctrlDrag(svg, 0, 2);
    expect(rotationOf(svg)).toBe(0);
    const again = render();
    ctrlDrag(again.svg, 0, -2.5);
    expect(rotationOf(again.svg)).toBe(0);
  });

  it("snaps to 15° steps while Shift is held", () => {
    const { svg } = render();
    ctrlDrag(svg, 0, 37, true);
    expect(rotationOf(svg)).toBe(30);
    const again = render();
    ctrlDrag(again.svg, 0, 38, true);
    expect(rotationOf(again.svg)).toBe(45);
  });

  it("animates back to upright the short way round", async () => {
    const { svg, changes } = render(350);
    resetFanRotation(svg);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(rotationOf(svg)).toBe(0);
    // 350° is -10°: every intermediate step stays between -10° and 0°
    // rather than sweeping down through 180°.
    expect(changes.length).toBeGreaterThan(0);
    for (const deg of changes) {
      expect(deg).toBeGreaterThanOrEqual(-10 - 1e-9);
      expect(deg).toBeLessThanOrEqual(0 + 1e-9);
    }
  });

  it("is a no-op when already upright", async () => {
    const { svg, changes } = render(0);
    resetFanRotation(svg);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(changes).toEqual([]);
  });
});
