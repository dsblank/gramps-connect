// Turns a chart built from ordinary page elements (cards, badges, avatars
// laid out by the browser, with an SVG layer for the connecting lines) into
// an SVG the chart export (ChartExportDialog / prepareSvg.ts) can work
// with, so those charts get the same "Export image" as the d3-drawn fan
// and box tree. Used by the Graphs view's Generations and Relationship
// charts.
//
// Nothing is redrawn from the chart's own data: every box, line of text
// and image is copied from where the browser actually put it on screen --
// so wrapped names, truncated labels and the layout come out exactly as
// shown, and any chart of this kind can use it without export code of its
// own. Each call builds a fresh copy (the chart may have changed since the
// last one) inside a hidden holder in the page, since the export measures
// it (getBBox) and that only works on rendered elements.
//
// Covered: background colors, borders (solid/dashed/dotted, rounded
// corners), text (font, color, wrapping, line clamps and ellipses),
// <img> (object-fit, rounded clipping) and inline <svg>s, which are copied
// as they are. Not covered: box shadows, gradients, background images,
// z-index (everything paints in page order). Anything marked
// `data-export-exclude` -- interactive controls like "+"/"−" markers --
// is left out with all it contains.
//
// Colors are read in the app's current theme and, when they differ, also
// in the light theme (the `data-light-*` attributes prepareSvg.ts swaps in
// for a "Light (for printing)" export).
import type { LegendEntry } from "../../charts/personColors";
import { setExportLegend } from "./legend";
import { withColorScheme } from "./prepareSvg";

const SVG_NS = "http://www.w3.org/2000/svg";

interface Paint {
  background: string;
  borders: [string, string, string, string];
  color: string;
}

/** A color as a hex value plus a separate opacity: what every export
 * format (svg2pdf included) reads reliably, whatever form the browser
 * computed it in (rgba(), color(srgb ...), oklab(), ...). */
interface Rgba {
  hex: string;
  alpha: number;
}

let colorCanvas: CanvasRenderingContext2D | null = null;
const colorCache = new Map<string, Rgba | null>();

function parseColor(css: string): Rgba | null {
  if (!css || css === "transparent") return null;
  const cached = colorCache.get(css);
  if (cached !== undefined) return cached;
  let result: Rgba | null = null;
  if (typeof CSS === "undefined" || CSS.supports("color", css)) {
    if (!colorCanvas) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      colorCanvas = canvas.getContext("2d", { willReadFrequently: true });
    }
    if (colorCanvas) {
      colorCanvas.clearRect(0, 0, 1, 1);
      colorCanvas.fillStyle = css;
      colorCanvas.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = colorCanvas.getImageData(0, 0, 1, 1).data;
      if (a > 0) {
        const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        result = { hex, alpha: Math.round((a / 255) * 1000) / 1000 };
      }
    }
  }
  colorCache.set(css, result);
  return result;
}

function readPaint(style: CSSStyleDeclaration): Paint {
  return {
    background: style.backgroundColor,
    borders: [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor],
    color: style.color,
  };
}

/** Sets `attr` (fill/stroke) and its opacity to `current`, plus
 * `data-light-*` copies of both when the light theme's color differs. */
function setColor(el: Element, attr: "fill" | "stroke", current: Rgba, light: Rgba | null | undefined): void {
  el.setAttribute(attr, current.hex);
  el.setAttribute(`${attr}-opacity`, String(current.alpha));
  if (light && (light.hex !== current.hex || light.alpha !== current.alpha)) {
    el.setAttribute(`data-light-${attr}`, light.hex);
    el.setAttribute(`data-light-${attr}-opacity`, String(light.alpha));
  }
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function radiusOf(style: CSSStyleDeclaration, width: number, height: number): number {
  const raw = style.borderTopLeftRadius.split(/\s+/)[0] ?? "0";
  const value = parseFloat(raw) || 0;
  const px = raw.endsWith("%") ? (value / 100) * width : value;
  return Math.max(0, Math.min(px, width / 2, height / 2));
}

function intersect(a: DOMRect | null, b: DOMRect): DOMRect {
  if (!a) return b;
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

/** The element's padding box -- what its `overflow` clips its content to. */
function paddingBox(rect: DOMRect, style: CSSStyleDeclaration): DOMRect {
  const l = parseFloat(style.borderLeftWidth) || 0;
  const t = parseFloat(style.borderTopWidth) || 0;
  const r = parseFloat(style.borderRightWidth) || 0;
  const b = parseFloat(style.borderBottomWidth) || 0;
  return new DOMRect(rect.left + l, rect.top + t, Math.max(0, rect.width - l - r), Math.max(0, rect.height - t - b));
}

const clips = (style: CSSStyleDeclaration) => style.overflowX !== "visible" || style.overflowY !== "visible";

function fontOf(style: CSSStyleDeclaration): string {
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

let textCanvas: CanvasRenderingContext2D | null = null;
function measureCtx(style: CSSStyleDeclaration): CanvasRenderingContext2D | null {
  if (!textCanvas) textCanvas = document.createElement("canvas").getContext("2d");
  if (textCanvas) textCanvas.font = fontOf(style);
  return textCanvas;
}

/** `text` cut down (with "…") to fit `maxWidth` in `style`'s font. */
function fitWithEllipsis(text: string, maxWidth: number, style: CSSStyleDeclaration): string {
  const ctx = measureCtx(style);
  if (!ctx) return `${text}…`;
  let cut = text.trimEnd();
  while (cut.length > 0 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function transformText(text: string, transform: string): string {
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  if (transform === "capitalize") return text.replace(/(^|\s)(\S)/g, (_, s: string, c: string) => s + c.toUpperCase());
  return text;
}

/** One rendered line of a text node, in page (client) coordinates. */
interface TextLine {
  start: number;
  end: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Splits a text node into the lines the browser wrapped it onto, from
 * where each word landed. */
function textLines(node: Text): TextLine[] {
  const lines: TextLine[] = [];
  const range = document.createRange();
  for (const match of node.data.matchAll(/\S+/g)) {
    const start = match.index!;
    const end = start + match[0].length;
    range.setStart(node, start);
    range.setEnd(node, end);
    const rect = range.getClientRects()[0];
    if (!rect || (rect.width === 0 && rect.height === 0)) continue;
    const line = lines[lines.length - 1];
    if (line && Math.abs(rect.top - line.top) < rect.height / 2) {
      line.end = end;
      line.right = Math.max(line.right, rect.right);
      line.bottom = Math.max(line.bottom, rect.bottom);
    } else {
      lines.push({ start, end, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
    }
  }
  range.detach();
  return lines;
}

interface WalkState {
  /** Where the chart's own (0, 0) is, in page coordinates. */
  originX: number;
  originY: number;
  /** Everything drawn goes in here. */
  out: SVGGElement;
  defs: SVGDefsElement;
  light: Map<Element, Paint>;
  clipSeq: number;
}

interface Context {
  /** The area content is clipped to here (overflow), page coordinates;
   * null = nothing clips. */
  clip: DOMRect | null;
  /** The corner radius of the box that clip came from. */
  clipRadius: number;
  opacity: number;
}

function withOpacity(el: Element, opacity: number): Element {
  if (opacity < 1) el.setAttribute("opacity", String(Math.round(opacity * 1000) / 1000));
  return el;
}

function drawBox(el: Element, style: CSSStyleDeclaration, rect: DOMRect, s: WalkState, opacity: number): void {
  const x = rect.left - s.originX;
  const y = rect.top - s.originY;
  const { width: w, height: h } = rect;
  const radius = radiusOf(style, w, h);
  const light = s.light.get(el);

  const background = parseColor(style.backgroundColor);
  if (background) {
    const r = svgEl("rect", { x, y, width: w, height: h, rx: radius });
    setColor(r, "fill", background, light && parseColor(light.background));
    s.out.appendChild(withOpacity(r, opacity));
  }

  const sides = (["top", "right", "bottom", "left"] as const).map((side, i) => ({
    width: parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0,
    style: style.getPropertyValue(`border-${side}-style`),
    color: style.getPropertyValue(`border-${side}-color`),
    light: light?.borders[i],
  }));
  const visible = sides.map((b) => b.width > 0 && b.style !== "none" && b.style !== "hidden" && parseColor(b.color) !== null);
  if (!visible.some(Boolean)) return;
  const dash = (b: (typeof sides)[number]) =>
    b.style === "dashed" ? `${b.width * 3} ${b.width * 3}` : b.style === "dotted" ? `${b.width} ${b.width}` : null;
  const uniform = visible.every(Boolean) && sides.every((b) => b.width === sides[0].width && b.style === sides[0].style && b.color === sides[0].color);
  if (uniform) {
    const b = sides[0];
    const inset = b.width / 2;
    const r = svgEl("rect", {
      x: x + inset, y: y + inset, width: Math.max(0, w - b.width), height: Math.max(0, h - b.width),
      rx: Math.max(0, radius - inset), fill: "none", "stroke-width": b.width,
    });
    setColor(r, "stroke", parseColor(b.color)!, b.light !== undefined ? parseColor(b.light) : undefined);
    const d = dash(b);
    if (d) r.setAttribute("stroke-dasharray", d);
    s.out.appendChild(withOpacity(r, opacity));
    return;
  }
  // Individual sides (a divider's single top border, say): plain lines,
  // corners left square.
  sides.forEach((b, i) => {
    if (!visible[i]) return;
    const inset = b.width / 2;
    const [x1, y1, x2, y2] =
      i === 0 ? [x, y + inset, x + w, y + inset]
      : i === 1 ? [x + w - inset, y, x + w - inset, y + h]
      : i === 2 ? [x, y + h - inset, x + w, y + h - inset]
      : [x + inset, y, x + inset, y + h];
    const line = svgEl("line", { x1, y1, x2, y2, "stroke-width": b.width });
    setColor(line, "stroke", parseColor(b.color)!, b.light !== undefined ? parseColor(b.light) : undefined);
    const d = dash(b);
    if (d) line.setAttribute("stroke-dasharray", d);
    s.out.appendChild(withOpacity(line, opacity));
  });
}

function drawText(node: Text, parent: Element, style: CSSStyleDeclaration, s: WalkState, ctx: Context): void {
  if (!node.data.trim()) return;
  const color = parseColor(style.color);
  if (!color) return;
  const all = textLines(node);
  const clip = ctx.clip;
  const tolerance = 1;
  const shown = clip ? all.filter((l) => l.top >= clip.top - tolerance && l.bottom <= clip.bottom + tolerance) : all;
  if (shown.length === 0) return;
  const cutBelow = shown.length < all.length;

  const ctx2d = measureCtx(style);
  const metrics = ctx2d?.measureText("Hg");
  const fontSize = parseFloat(style.fontSize) || 12;
  const ascent = metrics?.fontBoundingBoxAscent || fontSize * 0.8;
  const descent = metrics?.fontBoundingBoxDescent || fontSize * 0.2;
  const light = s.light.get(parent);
  const preserve = style.whiteSpace.startsWith("pre");

  shown.forEach((line, i) => {
    let text = node.data.slice(line.start, line.end);
    if (!preserve) text = text.replace(/\s+/g, " ");
    text = transformText(text, style.textTransform);
    const last = i === shown.length - 1;
    if (clip && (line.right > clip.right + tolerance || (last && cutBelow))) {
      text = fitWithEllipsis(text, Math.max(0, clip.right - line.left), style);
    }
    const height = line.bottom - line.top;
    const baseline = line.top + (height - (ascent + descent)) / 2 + ascent;
    const el = svgEl("text", {
      x: line.left - s.originX,
      y: baseline - s.originY,
      "font-family": style.fontFamily.replace(/"/g, "'"),
      "font-size": style.fontSize,
      "font-weight": style.fontWeight,
    });
    if (style.fontStyle !== "normal") el.setAttribute("font-style", style.fontStyle);
    if (style.letterSpacing !== "normal") el.setAttribute("letter-spacing", style.letterSpacing);
    if (preserve) el.setAttribute("xml:space", "preserve");
    setColor(el, "fill", color, light && parseColor(light.color));
    el.textContent = text;
    s.out.appendChild(withOpacity(el, ctx.opacity));
  });
}

function drawImage(img: HTMLImageElement, style: CSSStyleDeclaration, rect: DOMRect, s: WalkState, ctx: Context): void {
  const src = img.currentSrc || img.src;
  if (!src || !img.complete || img.naturalWidth === 0) return;
  const fit = style.objectFit;
  const image = svgEl("image", {
    x: rect.left - s.originX,
    y: rect.top - s.originY,
    width: rect.width,
    height: rect.height,
    href: src,
    preserveAspectRatio: fit === "cover" ? "xMidYMid slice" : fit === "fill" ? "none" : "xMidYMid meet",
  });
  // Rounded clipping: the image's own corners, or (an avatar) those of the
  // box that clips it.
  const area = ctx.clip ? intersect(ctx.clip, rect) : rect;
  const radius = Math.max(radiusOf(style, rect.width, rect.height), ctx.clip ? ctx.clipRadius : 0);
  if (ctx.clip || radius > 0) {
    const id = `html-export-clip-${++s.clipSeq}`;
    const clipPath = svgEl("clipPath", { id });
    clipPath.appendChild(svgEl("rect", {
      x: area.left - s.originX, y: area.top - s.originY, width: area.width, height: area.height, rx: radius,
    }));
    s.defs.appendChild(clipPath);
    image.setAttribute("clip-path", `url(#${id})`);
  }
  s.out.appendChild(withOpacity(image, ctx.opacity));
}

/** An inline `<svg>` (connector lines, icons) copied as it is, moved to
 * where it sits and scaled the way its viewBox says. Its `var(--...)`
 * colors are resolved later by prepareSvg.ts like any chart's. */
function drawInlineSvg(svg: SVGSVGElement, style: CSSStyleDeclaration, rect: DOMRect, s: WalkState, opacity: number): void {
  if (rect.width <= 0 && rect.height <= 0 && style.overflow !== "visible") return;
  const g = svgEl("g", {});
  let transform = `translate(${rect.left - s.originX} ${rect.top - s.originY})`;
  const viewBox = svg.viewBox?.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
    const dx = (rect.width - viewBox.width * scale) / 2;
    const dy = (rect.height - viewBox.height * scale) / 2;
    transform += ` translate(${dx} ${dy}) scale(${scale}) translate(${-viewBox.x} ${-viewBox.y})`;
  }
  g.setAttribute("transform", transform);
  // `currentColor` inside it means the color it inherits on the page.
  const color = parseColor(style.color);
  if (color) g.setAttribute("color", color.hex);
  for (const name of ["fill", "stroke", "stroke-width"]) {
    const value = svg.getAttribute(name);
    if (value) g.setAttribute(name, value);
  }
  for (const child of Array.from(svg.childNodes)) g.appendChild(child.cloneNode(true));
  s.out.appendChild(withOpacity(g, opacity));
}

function walk(el: Element, s: WalkState, ctx: Context): void {
  if (el.hasAttribute("data-export-exclude")) return;
  const tag = el.tagName.toLowerCase();
  if (tag === "style" || tag === "script" || tag === "template" || tag === "noscript") return;
  const style = getComputedStyle(el);
  if (style.display === "none") return;
  const opacity = ctx.opacity * (parseFloat(style.opacity) || 0);
  if (opacity <= 0) return;
  const visible = style.visibility === "visible";
  const rect = el.getBoundingClientRect();

  if (el instanceof SVGSVGElement) {
    if (visible) drawInlineSvg(el, style, rect, s, opacity);
    return;
  }
  if (el instanceof HTMLImageElement) {
    if (visible) drawImage(el, style, rect, s, { ...ctx, opacity });
    return;
  }
  if (visible && rect.width > 0 && rect.height > 0) drawBox(el, style, rect, s, opacity);

  let inner: Context = { ...ctx, opacity };
  if (clips(style)) {
    inner = { ...inner, clip: intersect(ctx.clip, paddingBox(rect, style)), clipRadius: radiusOf(style, rect.width, rect.height) };
  }
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (visible) drawText(child as Text, el, style, s, inner);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      walk(child as Element, s, inner);
    }
  }
}

/** The part of `root` currently scrolled into view, page coordinates. */
function visibleArea(root: HTMLElement): DOMRect {
  let area = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  for (let el = root.parentElement; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (clips(style)) area = intersect(area, paddingBox(el.getBoundingClientRect(), style));
  }
  return intersect(area, root.getBoundingClientRect());
}

let host: HTMLDivElement | null = null;

export interface HtmlChartSnapshotOptions {
  /** The chart's color legend, drawn under the export like the fan's. */
  legend?: readonly LegendEntry[] | null;
}

/** An SVG copy of the chart in `root` (see the top of this file), ready to
 * hand to ChartExportDialog as its `getSvg()`. Whole-chart export frames
 * everything drawn, "current view" the part scrolled into view. */
export function snapshotHtmlChart(root: HTMLElement | null, options: HtmlChartSnapshotOptions = {}): SVGSVGElement | null {
  if (!root || !root.isConnected) return null;
  // The light theme's colors, read first in one go: flipping the theme and
  // reading styles back never yields to a paint, so the screen never shows
  // it (see prepareSvg.ts's withColorScheme).
  const elements = [root, ...Array.from(root.querySelectorAll("*"))].filter((el) => !el.closest("svg"));
  const light = withColorScheme("light", () => {
    const map = new Map<Element, Paint>();
    for (const el of elements) map.set(el, readPaint(getComputedStyle(el)));
    return map;
  });

  const origin = root.getBoundingClientRect();
  const svg = svgEl("svg", {});
  const defs = svgEl("defs", {});
  const out = svgEl("g", { "data-export-content": "" });
  svg.append(defs, out);
  const state: WalkState = { originX: origin.left, originY: origin.top, out, defs, light, clipSeq: 0 };
  walk(root, state, { clip: null, clipRadius: 0, opacity: 1 });

  const view = visibleArea(root);
  const vx = view.left - origin.left;
  const vy = view.top - origin.top;
  svg.setAttribute("viewBox", `${vx} ${vy} ${Math.max(1, view.width)} ${Math.max(1, view.height)}`);
  svg.setAttribute("width", String(Math.max(1, view.width)));
  svg.setAttribute("height", String(Math.max(1, view.height)));
  setExportLegend(svg, options.legend);

  if (!host || !host.isConnected) {
    host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    // Rendered (getBBox needs that) but invisible and out of the way.
    Object.assign(host.style, {
      position: "fixed", left: "0", top: "0", width: "0", height: "0",
      overflow: "hidden", visibility: "hidden", pointerEvents: "none",
    });
    document.body.appendChild(host);
  }
  host.replaceChildren(svg);
  return svg;
}
