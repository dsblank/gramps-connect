// A color legend under an exported chart, so a saved or printed chart
// colored by tag or attribute still says what its colors mean. A chart opts
// in by attaching its legend to its live SVG (setExportLegend), the same
// way it marks what to export with data attributes; prepareSvg.ts adds the
// band below the frame and measureExportFrame counts it in the size.
import type { LegendEntry } from "../../charts/personColors";

const SVG_NS = "http://www.w3.org/2000/svg";

const legends = new WeakMap<SVGSVGElement, LegendEntry[]>();

export function setExportLegend(live: SVGSVGElement, entries: readonly LegendEntry[] | null | undefined): void {
  if (entries && entries.length > 0) legends.set(live, [...entries]);
  else legends.delete(live);
}

export function exportLegendOf(live: SVGSVGElement): LegendEntry[] | null {
  return legends.get(live) ?? null;
}

const FONT_SIZE = 12;
const SWATCH = 12;
const ROW_HEIGHT = 20;
const GAP_AFTER_SWATCH = 5;
const GAP_BETWEEN = 16;
/** Space between the chart's frame and the first legend row. */
const TOP_GAP = 8;
const BOTTOM_PAD = 8;
/** Rough average glyph width at FONT_SIZE -- the copy isn't rendered when
 * this runs, so text can't be measured. Generous, so entries wrap early
 * rather than overlap. */
const CHAR_WIDTH = FONT_SIZE * 0.62;

export interface LegendItemLayout {
  entry: LegendEntry;
  x: number;
  y: number;
  text: string;
}

export interface LegendLayout {
  height: number;
  items: LegendItemLayout[];
}

/** Lays entries out left to right, wrapping at `width`. x/y are relative
 * to the band's top-left; y is the row's vertical middle. */
export function layoutLegend(entries: readonly LegendEntry[], width: number): LegendLayout {
  const items: LegendItemLayout[] = [];
  let x = 0;
  let row = 0;
  for (const entry of entries) {
    const text = entry.count != null ? `${entry.label}  ${entry.count}` : entry.label;
    const itemWidth = SWATCH + GAP_AFTER_SWATCH + text.length * CHAR_WIDTH;
    if (x > 0 && x + itemWidth > width) {
      x = 0;
      row++;
    }
    items.push({ entry, x, y: TOP_GAP + row * ROW_HEIGHT + ROW_HEIGHT / 2, text });
    x += itemWidth + GAP_BETWEEN;
  }
  const rows = items.length ? row + 1 : 0;
  return { height: rows ? TOP_GAP + rows * ROW_HEIGHT + BOTTOM_PAD : 0, items };
}

/** Draws `layout` into `svg` with its top-left at (left, top). Text uses
 * the theme's text color (baked to a literal later, like the rest of the
 * chart); only the swatch carries the color. */
export function drawLegend(svg: SVGSVGElement, layout: LegendLayout, left: number, top: number): void {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", "export-legend");
  g.setAttribute("font-size", String(FONT_SIZE));
  for (const item of layout.items) {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", String(left + item.x));
    rect.setAttribute("y", String(top + item.y - SWATCH / 2));
    rect.setAttribute("width", String(SWATCH));
    rect.setAttribute("height", String(SWATCH));
    rect.setAttribute("rx", "3");
    rect.setAttribute("fill", item.entry.color);
    rect.setAttribute("stroke", "rgba(0, 0, 0, 0.15)");
    g.appendChild(rect);
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(left + item.x + SWATCH + GAP_AFTER_SWATCH));
    text.setAttribute("y", String(top + item.y));
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("fill", "var(--mantine-color-text)");
    text.textContent = item.text;
    g.appendChild(text);
  }
  svg.appendChild(g);
}
