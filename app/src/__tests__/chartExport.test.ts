// @vitest-environment jsdom
// Chart export: page layout math, PDF font coverage, and the live-SVG ->
// standalone-SVG preparation every format shares (store/chartExport/).
import { afterEach, describe, expect, it } from "vitest";
import { addXlinkHrefs, rasterSize } from "../store/chartExport/exportChart";
import { layoutOnPage } from "../store/chartExport/paperSizes";
import { pdfFontsCover } from "../store/chartExport/pdfFonts";
import { exportTransformOf, measureExportFrame, prepareExportSvg } from "../store/chartExport/prepareSvg";
import { layoutLegend, setExportLegend } from "../store/chartExport/legend";
import { renderFanChart } from "../charts/fanChart";

describe("layoutOnPage", () => {
  it("picks landscape for a wide chart and portrait for a tall one in auto mode", () => {
    expect(layoutOnPage(300, 100, "A4", "auto", 10)).toMatchObject({ pageWidth: 297, pageHeight: 210 });
    expect(layoutOnPage(100, 300, "A4", "auto", 10)).toMatchObject({ pageWidth: 210, pageHeight: 297 });
  });

  it("honours an explicit orientation even against the chart's shape", () => {
    expect(layoutOnPage(300, 100, "A4", "portrait", 10)).toMatchObject({ pageWidth: 210, pageHeight: 297 });
  });

  it("fits inside the margins, keeps the aspect ratio, and centers", () => {
    const page = layoutOnPage(200, 100, "A3", "landscape", 10);
    // A3 landscape 420x297, 400x277 usable -> width-bound at 400x200.
    expect(page.width).toBeCloseTo(400, 6);
    expect(page.height).toBeCloseTo(200, 6);
    expect(page.x).toBeCloseTo(10, 6);
    expect(page.y).toBeCloseTo((297 - 200) / 2, 6);
  });
});

describe("rasterSize", () => {
  it("scales the longer side to the requested pixels, keeping aspect", () => {
    expect(rasterSize(800, 400, 4000)).toEqual({ width: 4000, height: 2000 });
    expect(rasterSize(400, 800, 3000)).toEqual({ width: 1500, height: 3000 });
  });

  it("clamps to the per-side canvas limit", () => {
    expect(rasterSize(100, 100, 100000)).toEqual({ width: 16384, height: 16384 });
  });
});

describe("pdfFontsCover", () => {
  it("covers Western, Central European, Greek, and Cyrillic names plus chart symbols", () => {
    expect(pdfFontsCover("José Müller-Łukasiewicz † 1890–1951 …")).toBe(true);
    expect(pdfFontsCover("Αλέξανδρος Παπαδόπουλος")).toBe(true);
    expect(pdfFontsCover("Иван Петрович Сидоров")).toBe(true);
  });

  it("doesn't claim CJK, Arabic, or Hebrew", () => {
    expect(pdfFontsCover("张伟")).toBe(false);
    expect(pdfFontsCover("محمد")).toBe(false);
    expect(pdfFontsCover("דוד")).toBe(false);
  });
});

const SVG_NS = "http://www.w3.org/2000/svg";

/** A minimal opted-in chart: panned/zoomed + rotated content group, an
 * excluded marker, a var()-colored label. jsdom has no layout, so getBBox
 * (which prepareSvg's whole-chart frame measures with) is stubbed. */
function liveChart(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "500");
  svg.setAttribute("height", "300");
  svg.setAttribute("font-family", "var(--mantine-font-family)");
  svg.innerHTML = `
    <g id="content" data-export-content="" data-export-transform="rotate(30)" transform="translate(250,150) scale(3) rotate(30)">
      <text fill="var(--mantine-color-text)">Ann</text>
      <g data-export-exclude=""><circle r="4"/></g>
    </g>`;
  document.body.appendChild(svg);
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () => new DOMRect(-100, -80, 200, 160);
  return svg;
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute("style");
});

describe("prepareExportSvg", () => {
  it("frames the whole chart: pan/zoom dropped, rotation kept, margin added", async () => {
    const { svg, width, height } = await prepareExportSvg(liveChart(), {
      area: "whole", colors: "current", keepRotation: true, background: true,
    });
    expect(svg.querySelector("#content")!.getAttribute("transform")).toBe("rotate(30)");
    expect(svg.getAttribute("viewBox")).toBe("-116 -96 232 192");
    expect([width, height]).toEqual([232, 192]);
  });

  it("drops the rotation too when asked for an upright export", async () => {
    const { svg } = await prepareExportSvg(liveChart(), {
      area: "whole", colors: "current", keepRotation: false, background: true,
    });
    expect(svg.querySelector("#content")!.hasAttribute("transform")).toBe(false);
  });

  it("keeps exactly what's on screen for the current view", async () => {
    const { svg, width, height } = await prepareExportSvg(liveChart(), {
      area: "view", colors: "current", keepRotation: false, background: true,
    });
    expect(svg.querySelector("#content")!.getAttribute("transform")).toBe("translate(250,150) scale(3) rotate(30)");
    expect([width, height]).toEqual([500, 300]);
  });

  it("re-points a rotated fan's labels for an upright export, on its own renamed arcs", async () => {
    const person = (h: string) => ({ handle: h, gramps_id: h, gender: 0, profile: { name_given: `G${h}`, name_surname: `S${h}` } });
    const live = renderFanChart(
      { person: person("1"), children: [{ person: person("2") }, { person: person("3") }] },
      { bboxWidth: 400, bboxHeight: 400, initialRotation: 270, sizeByLifespan: false, colorScheme: "gen" },
    );
    document.body.appendChild(live);
    (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () => new DOMRect(-100, -80, 200, 160);
    const arcFor = (svg: SVGSVGElement) => {
      const href = svg.querySelector("textPath")!.getAttribute("href")!;
      return { href, d: svg.getElementById(href.slice(1))?.getAttribute("d") };
    };
    const upright = renderFanChart(
      { person: person("1"), children: [{ person: person("2") }, { person: person("3") }] },
      { bboxWidth: 400, bboxHeight: 400, sizeByLifespan: false, colorScheme: "gen" },
    );
    const { svg } = await prepareExportSvg(live, { area: "whole", colors: "current", keepRotation: false, background: true });
    expect(arcFor(svg).href).not.toBe(arcFor(live).href);
    expect(arcFor(svg).d).toBe(arcFor(upright).d);
    expect(arcFor(svg).d).not.toBe(arcFor(live).d);
  });

  it("reuses the live viewBox (offset included) for the current view", async () => {
    const live = liveChart();
    live.setAttribute("viewBox", "-250 -150 500 300");
    const { svg } = await prepareExportSvg(live, { area: "view", colors: "current", keepRotation: false, background: true });
    expect(svg.getAttribute("viewBox")).toBe("-250 -150 500 300");
  });

  it("removes excluded chrome and never touches the live chart", async () => {
    const live = liveChart();
    const { svg } = await prepareExportSvg(live, { area: "whole", colors: "current", keepRotation: true, background: true });
    expect(svg.querySelector("circle")).toBeNull();
    expect(live.querySelector("circle")).not.toBeNull();
    expect(live.querySelector("#content")!.getAttribute("transform")).toContain("scale(3)");
  });

  it("bakes CSS custom properties into literals, quotes made attribute-safe", async () => {
    document.documentElement.style.setProperty("--mantine-color-text", "rgb(1, 2, 3)");
    document.documentElement.style.setProperty("--mantine-font-family", '"Segoe UI", sans-serif');
    document.documentElement.style.setProperty("--mantine-color-body", "#fafafa");
    const { svg, backgroundColor } = await prepareExportSvg(liveChart(), {
      area: "whole", colors: "current", keepRotation: true, background: true,
    });
    expect(svg.querySelector("text")!.getAttribute("fill")).toBe("rgb(1, 2, 3)");
    expect(svg.getAttribute("font-family")).toBe("'Segoe UI', sans-serif");
    expect(backgroundColor).toBe("#fafafa");
    expect(new XMLSerializer().serializeToString(svg)).not.toContain("var(");
  });

  it("paints a background rect only when asked", async () => {
    const opaque = await prepareExportSvg(liveChart(), { area: "whole", colors: "current", keepRotation: true, background: true });
    expect(opaque.svg.querySelector(":scope > rect")).not.toBeNull();
    const clear = await prepareExportSvg(liveChart(), { area: "whole", colors: "current", keepRotation: true, background: false });
    expect(clear.svg.querySelector(":scope > rect")).toBeNull();
  });
});

describe("export legend", () => {
  const entries = [
    { color: "#ff0000", label: "ToDo", count: 3 },
    { color: "#00ff00", label: "Brick wall", count: 1 },
    { color: "#c9c2b3", label: "No tag", count: 40 },
  ];

  it("wraps entries onto new rows when the frame is narrow", () => {
    const wide = layoutLegend(entries, 1000);
    expect(new Set(wide.items.map((i) => i.y)).size).toBe(1);
    const narrow = layoutLegend(entries, 90);
    expect(new Set(narrow.items.map((i) => i.y)).size).toBe(3);
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(layoutLegend([], 500).height).toBe(0);
  });

  it("adds a band under the chart, counted in the frame and the dialog's size", async () => {
    const live = liveChart();
    setExportLegend(live, entries);
    const band = layoutLegend(entries, 232 - 32).height;
    expect(measureExportFrame(live, "whole", true)!.height).toBe(192 + band);
    const { svg, height } = await prepareExportSvg(live, {
      area: "whole", colors: "current", keepRotation: true, background: true,
    });
    expect(height).toBe(192 + band);
    expect(svg.getAttribute("viewBox")).toBe(`-116 -96 232 ${192 + band}`);
    const legend = svg.querySelector(".export-legend")!;
    expect([...legend.querySelectorAll("text")].map((t) => t.textContent)).toEqual(["ToDo  3", "Brick wall  1", "No tag  40"]);
    expect(legend.querySelector("rect")!.getAttribute("fill")).toBe("#ff0000");
    // Text color is baked like the rest of the chart.
    expect(legend.innerHTML).not.toContain("var(");
    // Starts below the chart's own frame (frame bottom = -96 + 192).
    expect(Number(legend.querySelector("rect")!.getAttribute("y"))).toBeGreaterThan(96);
  });

  it("adds nothing once the legend is cleared", async () => {
    const live = liveChart();
    setExportLegend(live, entries);
    setExportLegend(live, null);
    const { svg, height } = await prepareExportSvg(live, {
      area: "whole", colors: "current", keepRotation: true, background: true,
    });
    expect(height).toBe(192);
    expect(svg.querySelector(".export-legend")).toBeNull();
  });
});

describe("exportTransformOf", () => {
  it("treats a zero rotation as no transform at all", () => {
    const svg = liveChart();
    svg.querySelector("#content")!.setAttribute("data-export-transform", "rotate(0)");
    expect(exportTransformOf(svg)).toBe("");
  });
});

describe("addXlinkHrefs", () => {
  it("mirrors every href as xlink:href, declared, for SVG 1.1 consumers", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.innerHTML = '<defs><path id="a" d="M0 0"/></defs><text><textPath href="#a">x</textPath></text><image href="data:,"/>';
    addXlinkHrefs(svg);
    const out = new XMLSerializer().serializeToString(svg);
    expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(out).toContain('xlink:href="#a"');
    expect(out).toContain('xlink:href="data:,"');
    expect(out).toContain('href="#a"');
  });
});
