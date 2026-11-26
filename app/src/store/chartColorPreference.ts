// The Graphs view's Color choices (fan, tree and Generations charts, plus
// the attribute, saved filter and GOQL query picked for them, and the fan
// chart's Palette for Generation and for Age at death), remembered
// across sessions in this browser. One record for all trees: an attribute
// type or saved filter a tree doesn't have just falls back to that tree's
// first one, the same as when it was never picked.
import { STORAGE_KEYS } from "./storageKeys";

export interface ChartColorPreference {
  fan: string;
  tree: string;
  family: string;
  attributeType: string | null;
  filterId: string | null;
  goql: string;
  /** charts/fanPalettes.ts ids; "original" for each scheme's own colors. */
  genPalette: string;
  deathPalette: string;
}

const DEFAULTS: ChartColorPreference = {
  fan: "gen", tree: "gender", family: "none", attributeType: null, filterId: null, goql: "",
  genPalette: "original", deathPalette: "original",
};

export function loadChartColorPreference(): ChartColorPreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.chartColors);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ChartColorPreference>;
    const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
    const strOrNull = (v: unknown) => (typeof v === "string" ? v : null);
    return {
      fan: str(parsed.fan, DEFAULTS.fan),
      tree: str(parsed.tree, DEFAULTS.tree),
      family: str(parsed.family, DEFAULTS.family),
      attributeType: strOrNull(parsed.attributeType),
      filterId: strOrNull(parsed.filterId),
      goql: str(parsed.goql, ""),
      genPalette: str(parsed.genPalette, DEFAULTS.genPalette),
      deathPalette: str(parsed.deathPalette, DEFAULTS.deathPalette),
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveChartColorPreference(pref: ChartColorPreference): void {
  try {
    localStorage.setItem(STORAGE_KEYS.chartColors, JSON.stringify(pref));
  } catch {
    // Private window or storage blocked: the choice just isn't remembered.
  }
}
