// How the Gramplets menu (MenuBar.tsx) lays out the tree's (window)
// Gramplets: one submenu per category, or a plain list when there'd only be
// one submenu anyway (a submenu holding everything is just an extra click).
import { grampletKind } from "./grampletManifest";
import type { Gramplet } from "./types";

export interface GrampletMenuGroup {
  /** The submenu's label, or null for the flat (single-group) layout. */
  category: string | null;
  gramplets: Gramplet[];
}

/** Store categories are lowercase tags ("chart", "data quality"); shown
 * with a leading capital. */
function displayCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Groups the window Gramplets among `gramplets` (View Gramplets are left
 * out -- they live in the panel). Categories are matched ignoring case and
 * surrounding spaces, sorted by name, with uncategorized ones last under
 * "Other"; Gramplets within a group are sorted by name. */
export function grampletMenuGroups(gramplets: Gramplet[], otherLabel = "Other"): GrampletMenuGroup[] {
  const windowGramplets = gramplets
    .filter((g) => grampletKind(g) === "window")
    .sort((a, b) => a.label.localeCompare(b.label));
  const byCategory = new Map<string, { label: string; gramplets: Gramplet[] }>();
  for (const gramplet of windowGramplets) {
    const raw = gramplet.category?.trim() ?? "";
    const key = raw.toLowerCase();
    const group = byCategory.get(key) ?? { label: raw ? displayCategory(raw) : otherLabel, gramplets: [] };
    group.gramplets.push(gramplet);
    byCategory.set(key, group);
  }
  if (byCategory.size <= 1) {
    return windowGramplets.length === 0 ? [] : [{ category: null, gramplets: windowGramplets }];
  }
  return [...byCategory.entries()]
    .sort(([aKey, a], [bKey, b]) => (aKey === "" ? 1 : bKey === "" ? -1 : a.label.localeCompare(b.label)))
    .map(([, group]) => ({ category: group.label, gramplets: group.gramplets }));
}
