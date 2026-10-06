// @vitest-environment jsdom
// Chart export: page layout math, PDF font coverage, and the live-SVG ->
// standalone-SVG preparation every format shares (store/chartExport/).
import { afterEach, describe, expect, it } from "vitest";
import { rasterSize } from "../store/chartExport/exportChart";
import { layoutOnPage } from "../store/chartExport/paperSizes";
import { pdfFontsCover } from "../store/chartExport/pdfFonts";
import { exportTransformOf, prepareExportSvg } from "../store/chartExport/prepareSvg";
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

describe("exportTransformOf", () => {
  it("treats a zero rotation as no transform at all", () => {
    const svg = liveChart();
    svg.querySelector("#content")!.setAttribute("data-export-transform", "rotate(0)");
    expect(exportTransformOf(svg)).toBe("");
  });
});
