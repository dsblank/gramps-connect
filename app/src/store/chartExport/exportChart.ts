// Chart -> file, for every format the export dialog offers
// (components/visuals/ChartExportDialog.tsx). All formats start from the
// same prepareExportSvg() standalone SVG, so "whole chart, independent of
// the on-screen zoom" holds for each of them alike.
import { clickDownloadLink } from "../downloadFile";
import { layoutOnPage, type PaperOrientation, type PaperSize } from "./paperSizes";
import { PDF_FONT_FAMILY, pdfFontsCover, registerPdfFonts } from "./pdfFonts";
import { prepareExportSvg, type ExportArea, type ExportColors } from "./prepareSvg";

export type ExportFormat = "png" | "jpeg" | "svg" | "pdf";

export interface ExportOptions {
  format: ExportFormat;
  area: ExportArea;
  colors: ExportColors;
  keepRotation: boolean;
  /** PNG/SVG only -- JPEG has no alpha and PDF pages are white anyway. */
  transparent: boolean;
  /** PNG/JPEG: the output's longer side, in pixels. */
  longEdgePx: number;
  /** PDF only. */
  paper: PaperSize;
  orientation: PaperOrientation;
  marginMm: number;
}

/** Per-side cap every current browser's canvas accepts. */
export const MAX_CANVAS_SIDE = 16384;
/** Total-pixel budget Safari (the strictest) accepts for one canvas;
 * larger works in Chrome/Firefox but not there. */
export const SAFE_CANVAS_AREA = 16_777_216;
/** Image-fallback PDF resolution (see exportPdf), before SAFE_CANVAS_AREA
 * caps it. */
const PDF_IMAGE_DPI = 300;

export interface ExportResult {
  /** Set when a PDF had to embed a picture of the chart instead of vector
   * text -- the dialog tells the user why. */
  pdfRasterized?: boolean;
}

/** The pixel size a raster export of a `width` x `height` frame comes out
 * at for a given long edge, clamped to MAX_CANVAS_SIDE. */
export function rasterSize(width: number, height: number, longEdgePx: number): { width: number; height: number } {
  const longEdge = Math.min(Math.max(1, Math.round(longEdgePx)), MAX_CANVAS_SIDE);
  const scale = longEdge / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function serialize(svg: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(svg);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Couldn't load the chart as an image"));
    image.src = src;
  });
}

async function rasterize(
  svg: SVGSVGElement,
  pixelWidth: number,
  pixelHeight: number,
  mime: "image/png" | "image/jpeg",
  fill: string | null,
): Promise<Blob> {
  const svgUrl = URL.createObjectURL(new Blob([serialize(svg)], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't render images to a canvas");
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    }
    ctx.drawImage(image, 0, 0, pixelWidth, pixelHeight);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.92));
    // A canvas over the browser's own size limit fails silently -- toBlob
    // just hands back null -- rather than throwing anything descriptive.
    if (!blob) {
      throw new Error(
        `${pixelWidth} × ${pixelHeight} px is too large for this browser to render. Try a smaller size, or SVG/PDF.`,
      );
    }
    return blob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  clickDownloadLink(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The text the chart actually draws (not `<style>` rules). */
function chartText(svg: SVGSVGElement): string {
  return Array.from(svg.querySelectorAll("text"))
    .map((t) => t.textContent ?? "")
    .join("");
}

/** svg2pdf's own text model is narrower than a browser's: it only knows
 * fonts registered with jsPDF, at exactly "normal"/"bold", and reads
 * `alignment-baseline` but not `dominant-baseline` (what d3 charts here
 * use to vertically center a label). Rewrites the clone to fit. */
function adaptForSvg2pdf(svg: SVGSVGElement): void {
  for (const el of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    if (el.hasAttribute("font-family")) el.removeAttribute("font-family");
    const weight = el.getAttribute("font-weight");
    if (weight !== null) {
      const numeric = weight === "bold" || weight === "bolder" ? 700 : Number(weight);
      el.setAttribute("font-weight", numeric >= 600 ? "bold" : "normal");
    }
    const baseline = el.getAttribute("dominant-baseline");
    if (baseline !== null && !el.hasAttribute("alignment-baseline")) {
      el.setAttribute("alignment-baseline", baseline);
    }
  }
  svg.setAttribute("font-family", PDF_FONT_FAMILY);
}

/** svg2pdf has no `<textPath>` support -- it would drop the fan chart's
 * curved labels entirely. Replaces each such `<text>` with one straight
 * `<text>` per glyph, placed and turned exactly where the browser lays that
 * glyph out on its path (getStartPositionOfChar/getRotationOfChar, in the
 * original text's own user space, so the copies go in as its siblings).
 * Needs `svg` attached to the document -- layout only exists there.
 * Glyphs the path is too short to hold have no position and are skipped,
 * the same as the browser leaves them undrawn. */
export function flattenTextPaths(svg: SVGSVGElement): void {
  const SVG_NS = "http://www.w3.org/2000/svg";
  for (const text of Array.from(svg.querySelectorAll<SVGTextElement>("text"))) {
    if (!text.querySelector("textPath")) continue;
    const content = text.textContent ?? "";
    const glyphs = document.createElementNS(SVG_NS, "g");
    for (const name of ["fill", "font-size", "font-weight", "font-family"]) {
      const value = text.getAttribute(name);
      if (value !== null) glyphs.setAttribute(name, value);
    }
    const count = Math.min(content.length, text.getNumberOfChars());
    for (let i = 0; i < count; i++) {
      if (/\s/.test(content[i])) continue;
      let at: DOMPoint;
      let angle: number;
      try {
        at = text.getStartPositionOfChar(i);
        angle = text.getRotationOfChar(i);
      } catch {
        continue;
      }
      const glyph = document.createElementNS(SVG_NS, "text");
      glyph.setAttribute("x", String(at.x));
      glyph.setAttribute("y", String(at.y));
      glyph.setAttribute("transform", `rotate(${angle} ${at.x} ${at.y})`);
      glyph.textContent = content[i];
      glyphs.appendChild(glyph);
    }
    text.replaceWith(glyphs);
  }
}

async function exportPdf(
  svg: SVGSVGElement,
  width: number,
  height: number,
  backgroundColor: string,
  options: ExportOptions,
  filename: string,
): Promise<ExportResult> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const layout = layoutOnPage(width, height, options.paper, options.orientation, options.marginMm);
  const doc = new jsPDF({
    unit: "mm",
    format: [layout.pageWidth, layout.pageHeight],
    orientation: layout.pageWidth > layout.pageHeight ? "landscape" : "portrait",
  });
  // A dark-theme export fills the whole sheet, not just the chart's own
  // frame -- a dark rectangle floating in a white margin looks like a
  // mistake. White on white is a harmless no-op for the usual light case.
  doc.setFillColor(backgroundColor);
  doc.rect(0, 0, layout.pageWidth, layout.pageHeight, "F");

  const rasterized = !pdfFontsCover(chartText(svg));
  if (rasterized) {
    const ideal = rasterSize(width, height, (Math.max(layout.width, layout.height) / 25.4) * PDF_IMAGE_DPI);
    const shrink = Math.min(1, Math.sqrt(SAFE_CANVAS_AREA / (ideal.width * ideal.height)));
    const pxW = Math.max(1, Math.floor(ideal.width * shrink));
    const pxH = Math.max(1, Math.floor(ideal.height * shrink));
    const png = await rasterize(svg, pxW, pxH, "image/png", backgroundColor);
    const bytes = new Uint8Array(await png.arrayBuffer());
    doc.addImage(bytes, "PNG", layout.x, layout.y, layout.width, layout.height);
  } else {
    await registerPdfFonts(doc);
    adaptForSvg2pdf(svg);
    // svg2pdf reads a few things (stylesheets, computed sizes) that only
    // resolve on an element that's actually in a document.
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden";
    host.appendChild(svg);
    document.body.appendChild(host);
    try {
      flattenTextPaths(svg);
      await svg2pdf(svg, doc, { x: layout.x, y: layout.y, width: layout.width, height: layout.height });
    } finally {
      host.remove();
    }
  }
  saveBlob(doc.output("blob"), filename);
  return { pdfRasterized: rasterized };
}

/** Exports the live chart `live` (its current on-screen `<svg>`) and hands
 * the result to the browser to save as `${baseName}.<ext>`. */
export async function exportChart(live: SVGSVGElement, baseName: string, options: ExportOptions): Promise<ExportResult> {
  const transparent = options.transparent && (options.format === "png" || options.format === "svg");
  const { svg, width, height, backgroundColor } = await prepareExportSvg(live, {
    area: options.area,
    colors: options.colors,
    keepRotation: options.keepRotation,
    background: !transparent,
  });

  switch (options.format) {
    case "svg":
      saveBlob(new Blob([serialize(svg)], { type: "image/svg+xml;charset=utf-8" }), `${baseName}.svg`);
      return {};
    case "png":
    case "jpeg": {
      const size = rasterSize(width, height, options.longEdgePx);
      const mime = options.format === "png" ? "image/png" : "image/jpeg";
      const blob = await rasterize(svg, size.width, size.height, mime, transparent ? null : backgroundColor);
      saveBlob(blob, `${baseName}.${options.format === "png" ? "png" : "jpg"}`);
      return {};
    }
    case "pdf":
      return exportPdf(svg, width, height, backgroundColor, options, `${baseName}.pdf`);
  }
}
