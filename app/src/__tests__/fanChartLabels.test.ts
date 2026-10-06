// @vitest-environment jsdom
// On-wedge text for the ancestor fan chart: which name/date lines fit a
// wedge, and which way that text faces (radial for narrow distant
// generations, flipped so nothing reads upside down).
import { describe, expect, it } from "vitest";
import { renderFanChart, wedgeLabelLines } from "../charts/fanChart";
import type { TreeNode, TreePersonRaw } from "../store/treeData";

const person = (given: string, surname: string, birth?: string, death?: string): TreePersonRaw => ({
  handle: `${given}-${surname}`,
  gramps_id: "I1",
  gender: 0,
  profile: {
    name_given: given,
    name_surname: surname,
    ...(birth ? { birth: { date: birth } } : {}),
    ...(death ? { death: { date: death } } : {}),
  },
} as TreePersonRaw);

const texts = (lines: { text: string }[]) => lines.map((l) => l.text);

describe("wedgeLabelLines", () => {
  const p = person("Antoni Józef", "Pieniążek", "1844-02-08", "1910-06-15");

  it("puts the whole name on one line when it fits, then both dates", () => {
    expect(texts(wedgeLabelLines(p, 400, 100, 10, 8))).toEqual(["Antoni Józef Pieniążek", "*1844-02-08", "†1910-06-15"]);
  });

  it("drops middle given names before splitting the name", () => {
    expect(texts(wedgeLabelLines(p, 100, 100, 10, 8))[0]).toBe("Antoni Pieniążek");
  });

  it("splits given name and surname onto two lines when one line is too narrow", () => {
    expect(texts(wedgeLabelLines(p, 60, 100, 10, 8)).slice(0, 2)).toEqual(["Antoni", "Pieniążek"]);
  });

  it("keeps the given name, not the surname, when only one line fits", () => {
    expect(texts(wedgeLabelLines(p, 60, 15, 10, 8))).toEqual(["Antoni"]);
  });

  it("fills remaining height with dates, birth first", () => {
    expect(texts(wedgeLabelLines(p, 60, 34, 10, 8))).toEqual(["Antoni", "Pieniążek", "*1844-02-08"]);
  });

  it("returns nothing when not even one name line fits", () => {
    expect(wedgeLabelLines(p, 60, 5, 10, 8)).toEqual([]);
  });

  it("falls back to the surname when there is no given name", () => {
    expect(texts(wedgeLabelLines(person("", "Pieniążek"), 60, 15, 10, 8))).toEqual(["Pieniążek"]);
  });
});

function fullTree(depth: number, handle = "1"): TreeNode {
  const p = person(`Given${handle}`, `Surname${handle}`);
  if (depth === 0) return { person: p };
  return { person: p, children: [fullTree(depth - 1, `${handle}f`), fullTree(depth - 1, `${handle}m`)] };
}

/** The label group's transform for the wedge whose name line reads `name`. */
function labelTransform(svg: SVGSVGElement, name: string): string {
  const text = [...svg.querySelectorAll("text")].find((t) => t.textContent?.startsWith(name));
  return text!.parentElement!.getAttribute("transform") ?? "";
}

describe("wedge label orientation", () => {
  const render = (initialRotation = 0, flipLabels = true) =>
    renderFanChart(fullTree(7), {
      bboxWidth: 800, bboxHeight: 800, initialRotation, sizeByLifespan: false, colorScheme: "gen", flipLabels,
    });

  it("turns narrow distant-generation labels radial", () => {
    const svg = render();
    // depth 1 (father): tangential; depth 7: radial.
    expect(labelTransform(svg, "Given1f ")).toMatch(/rotate\(90\)/);
    expect(labelTransform(svg, "Given1fffffff")).not.toMatch(/rotate\(90\)/);
  });

  it("flips tangential labels in the lower half, and only there", () => {
    const svg = render();
    // The father fills the west half; his parents split it into the
    // south-west and north-west quarters, so exactly one of them flips.
    const ff = labelTransform(svg, "Given1ff ");
    const fm = labelTransform(svg, "Given1fm ");
    expect([ff, fm].filter((t) => t.endsWith("rotate(180)"))).toHaveLength(1);
  });

  it("re-evaluates flips against the current rotation", () => {
    const upright = render(0);
    const turned = render(180);
    const flipped = (svg: SVGSVGElement) => labelTransform(svg, "Given1ff ").endsWith("rotate(180)");
    expect(flipped(turned)).toBe(!flipped(upright));
  });

  it("never flips when flipLabels is off", () => {
    const svg = render(0, false);
    expect([...svg.querySelectorAll("g.wedge > g")].some((g) => g.getAttribute("transform")?.includes("rotate(180)"))).toBe(false);
  });
});
