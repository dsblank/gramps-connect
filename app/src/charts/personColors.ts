// Coloring people in a chart by something recorded on them -- their tags or
// one of their attributes -- rather than by where they sit in the chart.
// Built once from the people actually drawn, so the legend only lists tags
// or values that appear, and a chart just asks colorFor(person) without
// knowing which scheme is active. Gramps feature request #11364.
import type { TreePersonRaw } from "../store/treeData";
import { gtkColorToCss } from "../components/related/color";
import { t } from "../i18n/i18n";

/** Fill for a person the scheme has nothing to say about (no tag, no value
 * for this attribute) -- the same neutral fanChart.ts's "Age at death"
 * already uses for an unknown age. */
export const NO_DATA_COLOR = "#c9c2b3";
/** Fill for attribute values past the 8 categorical slots. Darker than
 * NO_DATA_COLOR so "has some other value" and "has none" stay apart. */
export const OTHER_COLOR = "#8a877f";

/** The validated categorical palette's 8 slots (dataviz skill's
 * references/palette.md, light column), in their fixed order -- the order
 * is what keeps neighbours apart under color-vision deficiency. Light
 * values only, like fanChart.ts's own fills, which are the same hex in
 * both themes. */
const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

/** The palette's blue ramp, steps 250 -> 450 -> 700: one hue, light to
 * dark, for numeric attribute values. Starts at 250, the lightest step
 * that still clears 2:1 against the light surface. */
const SEQUENTIAL: readonly [string, string, string] = ["#86b6ef", "#2a78d6", "#0d366b"];

const NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;

export interface TagInfo {
  handle: string;
  name: string;
  /** Already CSS (#rrggbb), see gtkColorToCss. */
  color: string;
  priority: number;
}

export interface LegendEntry {
  color: string;
  label: string;
  /** People in the chart with this color; absent for a gradient's end
   * labels, which don't stand for a group. */
  count?: number;
}

export interface PersonColoring {
  /** null when the scheme has nothing for this person -- the chart picks
   * its own "no data" look (NO_DATA_COLOR). */
  colorFor(person: TreePersonRaw): string | null;
  /** A line for the person's tooltip saying why they got their color
   * ("Tags: ToDo, Brick wall"), or null. */
  detailFor(person: TreePersonRaw): string | null;
  legend: LegendEntry[];
}

/** Fill for a tag nobody picked a color for (Gramps stores black, as for
 * its own ToDo tag). Darker than NO_DATA_COLOR, so a tagged person never
 * looks untagged. */
export const UNCOLORED_TAG_COLOR = OTHER_COLOR;

/** A tag as the API returns it, with Gramps' 16-bit-per-channel color
 * converted. Black or missing becomes UNCOLORED_TAG_COLOR. */
export function toTagInfo(raw: { handle: string; name?: unknown; color?: unknown; priority?: unknown }): TagInfo {
  const css = gtkColorToCss(typeof raw.color === "string" ? raw.color : undefined);
  const valid = css && /^#[0-9a-f]{6}$/i.test(css) && css.toLowerCase() !== "#000000";
  return {
    handle: raw.handle,
    name: typeof raw.name === "string" ? raw.name : "",
    color: valid ? css.toLowerCase() : UNCOLORED_TAG_COLOR,
    priority: typeof raw.priority === "number" ? raw.priority : 0,
  };
}

/** A person's tags, best first: lowest priority number wins, as in Gramps'
 * own list views (peoplemodel.py column_tag_color). Handles that don't
 * resolve (a tag deleted since) are skipped. */
function tagsOf(person: TreePersonRaw, tags: ReadonlyMap<string, TagInfo>): TagInfo[] {
  return (person.tag_list ?? [])
    .map((h) => tags.get(h))
    .filter((tag): tag is TagInfo => !!tag)
    .sort((a, b) => a.priority - b.priority);
}

export function buildTagColoring(people: readonly TreePersonRaw[], tags: ReadonlyMap<string, TagInfo>): PersonColoring {
  const counts = new Map<string, number>();
  let untagged = 0;
  for (const p of people) {
    const best = tagsOf(p, tags)[0];
    if (best) counts.set(best.handle, (counts.get(best.handle) ?? 0) + 1);
    else untagged++;
  }
  const legend: LegendEntry[] = [...counts.keys()]
    .map((h) => tags.get(h)!)
    .sort((a, b) => a.priority - b.priority)
    .map((tag) => ({ color: tag.color, label: tag.name, count: counts.get(tag.handle)! }));
  if (untagged > 0) legend.push({ color: NO_DATA_COLOR, label: t("No tag"), count: untagged });
  return {
    colorFor: (p) => tagsOf(p, tags)[0]?.color ?? null,
    detailFor: (p) => {
      const names = tagsOf(p, tags).map((tag) => tag.name);
      return names.length ? `${t("Tags:")} ${names.join(", ")}` : null;
    },
    legend,
  };
}

type RawAttribute = NonNullable<TreePersonRaw["attribute_list"]>[number];

/** An attribute's type name. The API usually sends a plain string
 * ("Nickname", or a custom name), but a full serialized GrampsType
 * ({string, value}) is accepted too. */
export function attributeTypeName(attr: RawAttribute): string {
  const type = attr.type;
  if (typeof type === "string") return type;
  if (type && typeof type === "object" && typeof type.string === "string") return type.string;
  return "";
}

/** The first value this person has for an attribute type, trimmed, or null.
 * A person can carry the same type twice; the first one counts. */
function attributeValue(person: TreePersonRaw, type: string): string | null {
  for (const attr of person.attribute_list ?? []) {
    if (attributeTypeName(attr) !== type) continue;
    const v = typeof attr.value === "string" ? attr.value.trim() : "";
    if (v) return v;
  }
  return null;
}

/** Attribute types present on these people, most common first, with how
 * many people have each -- the choices for "Color by attribute". Leaves
 * out identifiers: a text attribute with a different value for every
 * person (an imported _UID or RIN) would only color 8 arbitrary people and
 * lump the rest into Other. Distinct numbers still shade along the ramp,
 * so those stay. */
export function attributeTypesIn(people: readonly TreePersonRaw[]): { type: string; count: number }[] {
  const values = new Map<string, Set<string>>();
  const counts = new Map<string, number>();
  for (const p of people) {
    const v = new Map<string, string>();
    for (const attr of p.attribute_list ?? []) {
      const name = attributeTypeName(attr);
      const value = typeof attr.value === "string" ? attr.value.trim() : "";
      if (name && value && !v.has(name)) v.set(name, value);
    }
    for (const [name, value] of v) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      if (!values.has(name)) values.set(name, new Set());
      values.get(name)!.add(value);
    }
  }
  return [...counts.entries()]
    .filter(([type, count]) => {
      const distinct = values.get(type)!;
      const identifier = count > CATEGORICAL.length && distinct.size === count && ![...distinct].every((x) => NUMBER.test(x));
      return !identifier;
    })
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}


export function buildAttributeColoring(people: readonly TreePersonRaw[], type: string): PersonColoring {
  const values = new Map<string, number>();
  let missing = 0;
  for (const p of people) {
    const v = attributeValue(p, type);
    if (v == null) missing++;
    else values.set(v, (values.get(v) ?? 0) + 1);
  }
  const numeric = values.size > 0 && [...values.keys()].every((v) => NUMBER.test(v));
  const colorOf = numeric ? numericColors(values) : categoricalColors(values);
  const legend = numeric ? numericLegend(values, colorOf) : categoricalLegend(values, colorOf);
  if (missing > 0) legend.push({ color: NO_DATA_COLOR, label: t("Not recorded"), count: missing });
  return {
    colorFor: (p) => {
      const v = attributeValue(p, type);
      return v == null ? null : colorOf(v);
    },
    detailFor: (p) => {
      const v = attributeValue(p, type);
      return v == null ? null : `${type}: ${v}`;
    },
    legend,
  };
}

/** Numbers (a research level 1-6, a count) shade light to dark over the
 * range present. A single value sits mid-ramp. */
function numericColors(values: ReadonlyMap<string, number>): (v: string) => string {
  const nums = [...values.keys()].map(Number);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return (v) => threeStopGradient(SEQUENTIAL, hi === lo ? 0.5 : (Number(v) - lo) / (hi - lo));
}

/** Up to 8 distinct numbers each get a legend row (a 1-6 scale reads as
 * six swatches); more than that shows just the two ends. */
function numericLegend(values: ReadonlyMap<string, number>, colorOf: (v: string) => string): LegendEntry[] {
  const sorted = [...values.keys()].sort((a, b) => Number(a) - Number(b));
  if (sorted.length <= CATEGORICAL.length) {
    return sorted.map((v) => ({ color: colorOf(v), label: v, count: values.get(v)! }));
  }
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  return [
    { color: colorOf(lo), label: lo },
    { color: colorOf(hi), label: hi },
  ];
}

/** The 8 most common values get the palette's slots, assigned in
 * alphabetical order so a value keeps its color while the same values are
 * on screen; everything else is "Other". Text values are never placed on a
 * gradient -- that would make unordered values look ordered. */
function categoricalColors(values: ReadonlyMap<string, number>): (v: string) => string {
  const top = [...values.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, CATEGORICAL.length)
    .map(([v]) => v)
    .sort((a, b) => a.localeCompare(b));
  const slot = new Map(top.map((v, i) => [v, CATEGORICAL[i]]));
  return (v) => slot.get(v) ?? OTHER_COLOR;
}

function categoricalLegend(values: ReadonlyMap<string, number>, colorOf: (v: string) => string): LegendEntry[] {
  const legend: LegendEntry[] = [];
  let other = 0;
  for (const v of [...values.keys()].sort((a, b) => a.localeCompare(b))) {
    const color = colorOf(v);
    if (color === OTHER_COLOR) other += values.get(v)!;
    else legend.push({ color, label: v, count: values.get(v)! });
  }
  if (other > 0) legend.push({ color: OTHER_COLOR, label: t("Other"), count: other });
  return legend;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function lerpColor(a: string, b: string, f: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([ar + (br - ar) * f, ag + (bg - ag) * f, ab + (bb - ab) * f]);
}

/** `f` in [0,1] walked across three stops (two linear segments). */
export function threeStopGradient(stops: readonly [string, string, string], f: number): string {
  const clamped = Math.min(1, Math.max(0, f));
  return clamped <= 0.5
    ? lerpColor(stops[0], stops[1], clamped * 2)
    : lerpColor(stops[1], stops[2], (clamped - 0.5) * 2);
}

function luminance(hex: string): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Near-black or near-white text, whichever contrasts more with `fill`.
 * Tag colors are whatever the tree's editors picked, so a chart can't
 * assume its usual text color stays readable on them. */
export function textColorOn(fill: string): { name: string; date: string } {
  const l = luminance(fill);
  // Contrast against black (#0b0b0b ~ 0.0037) vs white (#ffffff = 1).
  const dark = (l + 0.05) / (0.0037 + 0.05) >= (1.05) / (l + 0.05);
  return dark
    ? { name: "#0b0b0b", date: "rgba(0, 0, 0, 0.65)" }
    : { name: "#ffffff", date: "rgba(255, 255, 255, 0.8)" };
}
