// Turns a live, on-screen chart SVG into a standalone one fit for saving --
// the shared first step of every chart export format (exportChart.ts).
//
// Any chart drawn this app's usual imperative-d3 way can opt in with a
// couple of data attributes on its own SVG, no export code of its own:
//  - `data-export-content` on the group pan/zoom transforms (fanChart.ts's
//    #fan-chart-content, treeChart.ts's #tree-chart-content). "Whole chart"
//    export drops that group's live transform and frames its own bounding
//    box instead, so the result no longer depends on how the chart happens
//    to be zoomed or panned on screen.
//  - `data-export-transform` on that same group: the part of its transform
//    that *isn't* pan/zoom and should survive into the export -- the fan
//    chart's own `rotate(deg)`. Absent means identity.
//  - `data-export-exclude` on anything that's interactive chrome rather
//    than chart (the box tree's "+" expand markers).
// An SVG without `data-export-content` can still be exported, just only
// as "current view".

export type ExportArea = "whole" | "view";
/** "light" renders with the light theme's colors whatever the app is
 * showing right now -- what a printed or shared chart almost always wants;
 * "current" keeps whatever the screen shows (dark included). */
export type ExportColors = "light" | "current";

export interface PrepareOptions {
  area: ExportArea;
  colors: ExportColors;
  /** Only meaningful for area "whole" -- "view" always keeps exactly what's
   * on screen. */
  keepRotation: boolean;
  /** Paint a background rect behind the chart (false = transparent). */
  background: boolean;
}

export interface PreparedSvg {
  /** Detached, standalone: every `var(--...)` resolved to a literal, every
   * `<image>` inlined as a data: URL, viewBox set to the export frame. */
  svg: SVGSVGElement;
  /** The export frame's size in the chart's own user units. */
  width: number;
  height: number;
  /** The resolved background color, painted or not. */
  backgroundColor: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
/** Breathing room around a whole-chart export's own bounding box, in the
 * chart's user units. */
const WHOLE_CHART_MARGIN = 16;

export function contentGroupOf(svg: SVGSVGElement): SVGGElement | null {
  return svg.querySelector<SVGGElement>("[data-export-content]");
}

/** The non-pan/zoom transform a whole-chart export keeps by default -- ""
 * when the chart has none (or it's a no-op rotation). */
export function exportTransformOf(svg: SVGSVGElement): string {
  const raw = contentGroupOf(svg)?.getAttribute("data-export-transform")?.trim() ?? "";
  return /^rotate\(\s*-?0*(\.0*)?\s*\)$/.test(raw) ? "" : raw;
}

/** The frame a whole-chart export would use, in the svg's own user units:
 * the content group's bounding box *after* the kept (rotation) transform,
 * measured on a hidden throwaway copy inside the live svg -- getBBox only
 * works on rendered elements, and the live group itself has the pan/zoom
 * transform baked in. */
export function measureWholeChart(svg: SVGSVGElement, keepRotation: boolean): DOMRect | null {
  const content = contentGroupOf(svg);
  if (!content) return null;
  const probe = document.createElementNS(SVG_NS, "g");
  probe.setAttribute("visibility", "hidden");
  const copy = content.cloneNode(true) as SVGGElement;
  copy.querySelectorAll("[data-export-exclude]").forEach((el) => el.remove());
  const keep = keepRotation ? exportTransformOf(svg) : "";
  if (keep) copy.setAttribute("transform", keep);
  else copy.removeAttribute("transform");
  probe.appendChild(copy);
  svg.appendChild(probe);
  try {
    const box = probe.getBBox();
    if (box.width <= 0 || box.height <= 0) return null;
    return new DOMRect(
      box.x - WHOLE_CHART_MARGIN,
      box.y - WHOLE_CHART_MARGIN,
      box.width + 2 * WHOLE_CHART_MARGIN,
      box.height + 2 * WHOLE_CHART_MARGIN,
    );
  } finally {
    probe.remove();
  }
}

/** The export frame for `area`, without building anything -- what the
 * dialog's size readout uses. */
export function measureExportFrame(svg: SVGSVGElement, area: ExportArea, keepRotation: boolean): DOMRect | null {
  if (area === "whole") return measureWholeChart(svg, keepRotation);
  // The live chart's own viewBox *is* the current view (both charts offset
  // it so content (0,0) lands mid-panel) -- reuse it as is.
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return new DOMRect(viewBox[0], viewBox[1], viewBox[2], viewBox[3]);
  }
  const rect = svg.getBoundingClientRect();
  const width = parseFloat(svg.getAttribute("width") ?? "") || rect.width;
  const height = parseFloat(svg.getAttribute("height") ?? "") || rect.height;
  return width > 0 && height > 0 ? new DOMRect(0, 0, width, height) : null;
}

/** Reads every custom property `names` references off the document root,
 * optionally with the light color scheme forced on for the duration.
 * Flipping Mantine's own `data-mantine-color-scheme` attribute and reading
 * computed styles back synchronously never yields to a paint, so the
 * screen never shows the flip -- and it reads the app's *actual* theme
 * values (theme.ts's primary color included) rather than a hardcoded copy
 * that could drift from them. Custom properties' computed values already
 * have nested var()s substituted. */
function resolveCustomProperties(names: Iterable<string>, colors: ExportColors): Map<string, string> {
  const root = document.documentElement;
  const previous = root.getAttribute("data-mantine-color-scheme");
  const flip = colors === "light" && previous !== "light";
  if (flip) root.setAttribute("data-mantine-color-scheme", "light");
  try {
    const style = getComputedStyle(root);
    const values = new Map<string, string>();
    for (const name of names) values.set(name, style.getPropertyValue(name).trim());
    return values;
  } finally {
    if (flip) {
      if (previous === null) root.removeAttribute("data-mantine-color-scheme");
      else root.setAttribute("data-mantine-color-scheme", previous);
    }
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** An SVG rendered via `<img>` (raster export) can't load any external
 * resource at all, and svg2pdf needs image bytes it can decode itself, so
 * every `<image>` becomes a data: URL. One that can't be fetched is dropped
 * rather than failing the whole export. */
async function inlineImages(svg: SVGSVGElement): Promise<void> {
  const images = Array.from(svg.querySelectorAll("image"));
  const cache = new Map<string, Promise<string | null>>();
  await Promise.all(
    images.map(async (image) => {
      const href = image.getAttribute("href") ?? image.getAttributeNS(XLINK_NS, "href");
      if (!href || href.startsWith("data:")) return;
      if (!cache.has(href)) {
        cache.set(
          href,
          fetch(href)
            .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
            .then(blobToDataUrl)
            .catch(() => null),
        );
      }
      const dataUrl = await cache.get(href)!;
      if (!dataUrl) {
        image.remove();
        return;
      }
      image.removeAttributeNS(XLINK_NS, "href");
      image.setAttribute("href", dataUrl);
    }),
  );
}

/** Replaces every `var(--name)` / `var(--name, fallback)` in every
 * attribute and `<style>` with its resolved literal. Done on the markup
 * itself rather than via an injected `:root{--x:...}` rule, because
 * svg2pdf (PDF export) doesn't understand custom properties at all. */
function bakeCustomProperties(svg: SVGSVGElement, colors: ExportColors): string {
  const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g;
  const names = new Set<string>(["--mantine-color-body"]);
  const collect = (text: string) => {
    for (const match of text.matchAll(VAR_RE)) names.add(match[1]);
  };
  const elements = [svg, ...Array.from(svg.querySelectorAll("*"))];
  for (const el of elements) {
    for (const attr of Array.from(el.attributes)) collect(attr.value);
    if (el.tagName.toLowerCase() === "style") collect(el.textContent ?? "");
  }
  const values = resolveCustomProperties(names, colors);
  // Font stacks come back with double-quoted family names, which would
  // terminate a double-quoted XML attribute early once serialized.
  const substitute = (text: string) =>
    text.replace(VAR_RE, (_, name: string, fallback?: string) =>
      (values.get(name) || fallback?.trim() || "initial").replace(/"/g, "'"),
    );
  for (const el of elements) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.includes("var(")) el.setAttribute(attr.name, substitute(attr.value));
    }
    if (el.tagName.toLowerCase() === "style" && el.textContent?.includes("var(")) {
      el.textContent = substitute(el.textContent);
    }
  }
  return values.get("--mantine-color-body") || "#ffffff";
}

export async function prepareExportSvg(live: SVGSVGElement, options: PrepareOptions): Promise<PreparedSvg> {
  const frame = measureExportFrame(live, options.area, options.keepRotation);
  if (!frame) throw new Error("Nothing to export yet");

  const svg = live.cloneNode(true) as SVGSVGElement;
  svg.querySelectorAll("[data-export-exclude]").forEach((el) => el.remove());
  if (options.area === "whole") {
    const content = contentGroupOf(svg)!;
    const keep = options.keepRotation ? exportTransformOf(live) : "";
    if (keep) content.setAttribute("transform", keep);
    else content.removeAttribute("transform");
  }
  svg.setAttribute("viewBox", `${frame.x} ${frame.y} ${frame.width} ${frame.height}`);
  svg.setAttribute("width", String(frame.width));
  svg.setAttribute("height", String(frame.height));
  svg.removeAttribute("style");

  const backgroundColor = bakeCustomProperties(svg, options.colors);
  if (options.background) {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(frame.x));
    rect.setAttribute("y", String(frame.y));
    rect.setAttribute("width", String(frame.width));
    rect.setAttribute("height", String(frame.height));
    rect.setAttribute("fill", backgroundColor);
    // After any <style>/<defs> but before the chart itself, so it paints
    // underneath everything.
    const firstDrawn = Array.from(svg.children).find((c) => !["style", "defs"].includes(c.tagName.toLowerCase()));
    svg.insertBefore(rect, firstDrawn ?? null);
  }
  await inlineImages(svg);
  return { svg, width: frame.width, height: frame.height, backgroundColor };
}
