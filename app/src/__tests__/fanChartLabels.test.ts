// @vitest-environment jsdom
// On-wedge text for the ancestor fan chart: which name/date lines fit a
// wedge, and which way that text faces (radial for narrow distant
// generations, flipped so nothing reads upside down).
import { describe, expect, it } from "vitest";
import { fanArcPath, orientFanLabels, renderFanChart, wedgeLabelLines } from "../charts/fanChart";
import { flattenTextPaths } from "../store/chartExport/exportChart";
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

/** The text element whose content starts with `name`. */
function textFor(svg: SVGSVGElement, name: string): SVGTextElement {
  return [...svg.querySelectorAll("text")].find((t) => t.textContent?.startsWith(name))!;
}

/** Whether the curved line reading `name` runs counter-clockwise (flipped
 * to read upright) -- its arc's sweep flag. */
function arcFlipped(svg: SVGSVGElement, name: string): boolean {
  const id = textFor(svg, name).querySelector("textPath")!.getAttribute("href")!.slice(1);
  const d = svg.getElementById(id)!.getAttribute("d")!;
  return / 0 [01] 0 [-\d.e]+ [-\d.e]+$/.test(d);
}

describe("fanArcPath", () => {
  it("runs clockwise normally and counter-clockwise flipped, at the baseline radius", () => {
    expect(fanArcPath(0, Math.PI / 2, 100, 0, 10, false)).toBe("M0 -96.5A96.5 96.5 0 0 1 96.5 0");
    expect(fanArcPath(0, Math.PI / 2, 100, 0, 10, true)).toBe("M103.5 0A103.5 103.5 0 0 0 0 -103.5");
  });

  it("puts the first (negative-offset) line outward normally, inward flipped", () => {
    const radius = (d: string) => Number(/A([\d.]+)/.exec(d)![1]);
    expect(radius(fanArcPath(0, 1, 100, -10, 10, false))).toBeGreaterThan(100);
    expect(radius(fanArcPath(0, 1, 100, -10, 10, true))).toBeLessThan(100);
  });
});

describe("wedge label orientation", () => {
  const render = (initialRotation = 0, flipLabels = true) =>
    renderFanChart(fullTree(7), {
      bboxWidth: 800, bboxHeight: 800, initialRotation, sizeByLifespan: false, colorScheme: "gen", flipLabels,
    });

  it("curves inner-generation lines along their ring and turns distant ones radial", () => {
    const svg = render();
    expect(textFor(svg, "Given1f ").querySelector("textPath")).not.toBeNull();
    const deep = textFor(svg, "Given1fffffff");
    expect(deep.querySelector("textPath")).toBeNull();
    expect(deep.parentElement!.getAttribute("data-mode")).toBe("radial");
  });

  it("flips curved lines in the lower half, and only there", () => {
    const svg = render();
    // The father fills the west half; his parents split it into the
    // south-west and north-west quarters, so exactly one of them flips.
    expect([arcFlipped(svg, "Given1ff "), arcFlipped(svg, "Given1fm ")].filter(Boolean)).toHaveLength(1);
  });

  it("re-evaluates flips against the current rotation", () => {
    const svg = render(0);
    const before = arcFlipped(svg, "Given1ff ");
    orientFanLabels(svg, 180);
    expect(arcFlipped(svg, "Given1ff ")).toBe(!before);
    expect(arcFlipped(render(180), "Given1ff ")).toBe(!before);
  });

  it("never flips when flipLabels is off", () => {
    const svg = render(0, false);
    const names = [...svg.querySelectorAll("textPath")].map((t) => t.textContent!);
    expect(names.some((n) => arcFlipped(svg, n))).toBe(false);
    expect([...svg.querySelectorAll("g.fan-label")].some((g) => g.getAttribute("transform")?.includes("rotate(180)"))).toBe(false);
  });
});

describe("flattenTextPaths", () => {
  it("replaces curved text with one positioned, rotated text per glyph", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.innerHTML = '<text font-size="9" fill="red"><textPath href="#p">A b</textPath></text>';
    const text = svg.querySelector("text")! as SVGTextElement & Record<string, unknown>;
    text.getNumberOfChars = () => 3;
    text.getStartPositionOfChar = (i: number) => ({ x: i * 10, y: 5 }) as DOMPoint;
    text.getRotationOfChar = (i: number) => i * 3;
    flattenTextPaths(svg);
    const glyphs = [...svg.querySelectorAll("text")];
    expect(glyphs.map((g) => g.textContent)).toEqual(["A", "b"]);
    expect(glyphs[1].getAttribute("transform")).toBe("rotate(6 20 5)");
    expect(glyphs[0].parentElement!.getAttribute("font-size")).toBe("9");
    expect(svg.querySelector("textPath")).toBeNull();
  });
});
