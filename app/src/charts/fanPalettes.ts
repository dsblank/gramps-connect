// The fan chart's Palette choice (issue #63): which colors "Color:
// Generation" and "Color: Age at death" use. "Original" keeps each
// scheme's own hand-picked colors in fanChart.ts (GEN_COLORS, with their
// hand-picked outlines, and DEATH_COLORS); the rest come from ColorBrewer
// and matplotlib's Viridis, copied as fixed hex lists (exported from d3-
// scale-chromatic 3.1.1) rather than adding the package for a few arrays.
//
// ColorBrewer: Copyright (c) 2002 Cynthia Brewer, Mark Harrower, and The
// Pennsylvania State University. Licensed under the Apache License,
// Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0); see
// https://colorbrewer2.org. Viridis: Stéfan van der Walt and Nathaniel
// Smith, CC0. Tableau 10: Tableau's classic palette as published in
// d3-scale-chromatic (ISC).
//
// Two kinds:
// - "distinct": separate colors, one per generation, repeating past the
//   end of the list. Generation only: ages are a range, not categories.
// - "gradient": light to dark (or one hue to another). Age at death walks
//   it from the youngest to the oldest age in the chart; Generation walks
//   it from the center outward. ColorBrewer's lightest step (near white) is
//   left out of its sequential ramps, since it vanished against the chart
//   background and read like an empty slot.
import { gradientColor } from "./personColors";

export type FanPaletteKind = "distinct" | "gradient";

export interface FanPalette {
  id: string;
  /** English label, translated with t() where shown. */
  label: string;
  kind: FanPaletteKind;
  colors: readonly string[];
}

export const ORIGINAL_PALETTE_ID = "original";

export const FAN_PALETTES: readonly FanPalette[] = [
  // Distinct (ColorBrewer qualitative, plus Tableau 10).
  { id: "set3", label: "Pastel", kind: "distinct", colors: ["#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3", "#fdb462", "#b3de69", "#fccde5", "#d9d9d9", "#bc80bd", "#ccebc5", "#ffed6f"] },
  { id: "paired", label: "Paired", kind: "distinct", colors: ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99", "#e31a1c", "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a", "#ffff99", "#b15928"] },
  { id: "pastel1", label: "Light", kind: "distinct", colors: ["#fbb4ae", "#b3cde3", "#ccebc5", "#decbe4", "#fed9a6", "#ffffcc", "#e5d8bd", "#fddaec", "#f2f2f2"] },
  { id: "set2", label: "Soft", kind: "distinct", colors: ["#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854", "#ffd92f", "#e5c494", "#b3b3b3"] },
  { id: "dark2", label: "Strong", kind: "distinct", colors: ["#1b9e77", "#d95f02", "#7570b3", "#e7298a", "#66a61e", "#e6ab02", "#a6761d", "#666666"] },
  { id: "tableau10", label: "Classic", kind: "distinct", colors: ["#4e79a7", "#f28e2c", "#e15759", "#76b7b2", "#59a14f", "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab"] },
  // Gradients (ColorBrewer sequential, 9-class minus the lightest step;
  // ColorBrewer diverging Spectral; Viridis).
  { id: "blues", label: "Blues", kind: "gradient", colors: ["#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#08519c", "#08306b"] },
  { id: "greens", label: "Greens", kind: "gradient", colors: ["#e5f5e0", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#006d2c", "#00441b"] },
  { id: "purples", label: "Purples", kind: "gradient", colors: ["#efedf5", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#54278f", "#3f007d"] },
  { id: "oranges", label: "Oranges", kind: "gradient", colors: ["#fee6ce", "#fdd0a2", "#fdae6b", "#fd8d3c", "#f16913", "#d94801", "#a63603", "#7f2704"] },
  { id: "ylorrd", label: "Yellow to red", kind: "gradient", colors: ["#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#bd0026", "#800026"] },
  { id: "ylgnbu", label: "Yellow to blue", kind: "gradient", colors: ["#edf8b1", "#c7e9b4", "#7fcdbb", "#41b6c4", "#1d91c0", "#225ea8", "#253494", "#081d58"] },
  { id: "spectral", label: "Rainbow", kind: "gradient", colors: ["#9e0142", "#d53e4f", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#e6f598", "#abdda4", "#66c2a5", "#3288bd", "#5e4fa2"] },
  { id: "viridis", label: "Viridis", kind: "gradient", colors: ["#440154", "#472d7b", "#3b528b", "#2c728e", "#21918c", "#28ae80", "#5ec962", "#addc30", "#fde725"] },
];

/** The schemes a palette applies to. */
export type PaletteScheme = "gen" | "death";

/** The palettes offered for a scheme, after "Original": all of them for
 * Generation, gradients only for Age at death. */
export function palettesFor(scheme: PaletteScheme): readonly FanPalette[] {
  return scheme === "gen" ? FAN_PALETTES : FAN_PALETTES.filter((p) => p.kind === "gradient");
}

/** The palette with this id if it's offered for `scheme`, else null
 * (meaning Original -- also for an id from an older or newer version). */
export function findPalette(id: string | null | undefined, scheme: PaletteScheme): FanPalette | null {
  return palettesFor(scheme).find((p) => p.id === id) ?? null;
}

/** A generation's fill: distinct palettes repeat; gradients run from the
 * center (depth 0) to the outermost ring drawn (`maxDepth`). */
export function generationColor(palette: FanPalette, depth: number, maxDepth: number): string {
  if (palette.kind === "distinct") return palette.colors[depth % palette.colors.length];
  return gradientColor(palette.colors, maxDepth > 0 ? depth / maxDepth : 0);
}
