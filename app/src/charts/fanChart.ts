// Ancestor fan chart (View > Tree's "Fan" chart style) -- a radial sibling to
// treeChart.ts's box tree, sharing its overall shape (imperative d3, one SVG
// built and returned per render, d3-zoom for pan/zoom, `var(--mantine-...)`
// tokens for most chrome) but a completely different layout: concentric
// generation rings split by the father/mother binary already baked into
// TreeNode.children ([father, mother], see treeData.ts's ancestorNode) rather
// than d3-hierarchy's tree() layout. Two color schemes (Generation, Age at
// death) and an optional "size by lifespan" radial mode, both ported from
// harrywind.nl's own reference implementation -- see GEN_COLORS/DEATH_COLORS
// and lifespanThickness below.
import { arc as d3arc } from "d3-shape";
import { create } from "d3-selection";
import "d3-transition";
import { zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";
import type { TreeNode } from "../store/treeData";

const RING = 70;
/** A fixed *angle* gap sweeps an ever-wider arc length the further out it's
 * drawn (arc length = angle x radius) -- exactly the "gaps get huge near
 * the rim" effect a screenshot flagged. GAP_PX/MAX_PAD_ANGLE below drive a
 * per-wedge angle instead (see arcGen's own padAngle accessor), so the
 * visual gap stays the same few px at every depth. */
const GAP_PX = 1.5;
const MAX_PAD_ANGLE = 0.08;
const CORNER_RADIUS = 2;
/** Root sits this many px above the viewport's bottom edge at zoom 1 -- same
 * "frame on the root's own position, not the whole tree's bounding box"
 * instinct as treeChart.ts's own xOffset/yOffset (its own doc comment
 * explains why: a deep tree routinely exceeds the viewport, and centering
 * the whole thing pushes the root -- the one thing the user opened this for
 * -- off-frame). A fan's dome only grows *upward* from the root, so here
 * that just means anchoring the root near the bottom instead of the middle.
 */
const BOTTOM_MARGIN = 40;

/** Both palettes below are ported verbatim from harrywind.nl's own compiled
 * JS (its `GEN_COLORS`/`DEATH_COLORS` constants), not this app's usual
 * dataviz-skill-validated palette -- this feature's whole point is to steal
 * the reference site's own look, so these are a deliberate exception to
 * that validator the same way treeChart.ts's own GENDER_FILL already is
 * (a hand-picked domain pair, not a generated categorical slot). Each
 * GEN_COLORS entry is [fill, stroke] -- generation 1 is root/self, 1-indexed
 * to match the source; depths past 12 wrap rather than resetting to slot 1
 * outright, so a deeply "Increase depth"-ed branch still reads as
 * progressing. Same hex used for both light and dark mode: harrywind has no
 * dark mode of its own to steal a variant from, so there's nothing to
 * diverge -- revisit if these read poorly against the dark chart surface. */
const GEN_COLORS: readonly (readonly [string, string])[] = [
  ["#e2a545", "#b9822f"],
  ["#e0c24a", "#b89b32"],
  ["#a7c67e", "#7d9c56"],
  ["#78c2ad", "#4f9686"],
  ["#7ba3c9", "#5279a0"],
  ["#9a8dc9", "#6f639f"],
  ["#c187ac", "#985e83"],
  ["#c97e7e", "#a05252"],
  ["#cf9a5c", "#a8763a"],
  ["#b06b4a", "#8a4a30"],
  ["#8f9c6a", "#6f7a4e"],
  ["#6a9c8f", "#4e7a6f"],
];

/** A 3-stop (pale/mid/dark) gradient for the "Age at death" scheme, walked
 * the same two-segment way harrywind's own
 * `d3.scaleLinear().domain([lo,mid,hi]).range(DEATH_COLORS)` does -- see
 * threeStopGradient below. */
const DEATH_COLORS: readonly [string, string, string] = ["#eaf1ec", "#5f97c9", "#232449"];

export type FanColorScheme = "gen" | "death";

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

/** The same two-segment walk harrywind's own 3-stop d3.scaleLinear does,
 * hand-rolled since this chart doesn't otherwise depend on d3-scale. `t` is
 * pre-normalized to [0,1] by the caller. */
function threeStopGradient(stops: readonly [string, string, string], t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped <= 0.5
    ? lerpColor(stops[0], stops[1], clamped * 2)
    : lerpColor(stops[1], stops[2], (clamped - 0.5) * 2);
}

/** d3's own `color(hex).darker(0.9)` (each channel scaled by 0.7^0.9) --
 * harrywind's own strokeFor falls back to exactly this for any scheme
 * without its own hand-picked stroke pair (GEN_COLORS' own [1] slot is only
 * used for the 'gen' scheme itself); used here the same way, for 'death'. */
function darken(hex: string): string {
  const factor = Math.pow(0.7, 0.9);
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex([r * factor, g * factor, b * factor]);
}

function genFill(depth: number): string {
  return GEN_COLORS[depth % GEN_COLORS.length][0];
}

function genStroke(depth: number): string {
  return GEN_COLORS[depth % GEN_COLORS.length][1];
}

function clipString(s: string, widthPx: number, fontSize = 12): string {
  if (!s) return "";
  const nChar = Math.floor(widthPx / (fontSize * 0.6));
  if (s.length <= nChar) return s;
  if (nChar < 2) return "";
  return `${s.slice(0, nChar - 2)}…`;
}

function fitsWidth(s: string, widthPx: number, fontSize: number): boolean {
  return s.length * fontSize * 0.6 <= widthPx;
}

/** First given name (no middle names) + surname, falling back to surname
 * alone once the full pair doesn't fit the wedge's own width -- rather than
 * clipString's usual mid-word "…" truncation, which could just as easily
 * lop off the surname as the given name. Only falls through to a literal
 * character truncation (clipString, on the surname if there is one) once
 * even the surname alone doesn't fit -- a real edge case, not the normal
 * path. */
function nameLabel(
  given: string | null | undefined,
  surname: string | null | undefined,
  widthPx: number,
  fontSize: number,
): string {
  const firstGiven = given?.trim().split(/\s+/)[0] || "";
  const full = [firstGiven, surname].filter(Boolean).join(" ");
  if (full && fitsWidth(full, widthPx, fontSize)) return full;
  if (surname && fitsWidth(surname, widthPx, fontSize)) return surname;
  return clipString(surname || full, widthPx, fontSize);
}

/** Shrinks with depth, floor NAME_FONT_MIN -- harrywind's own labels do the
 * same (its own `fits()`/shrink loop uses live DOM text measurement to hit
 * an exact per-wedge fit; this is the same idea, a fixed depth-based curve
 * instead, since this chart already truncates by an estimated character
 * width (clipString) rather than measuring rendered text). The date line
 * runs 2px smaller than the name, floor DATE_FONT_MIN, matching harrywind's
 * own name/date size relationship. */
const NAME_FONT_MAX = 11;
const NAME_FONT_MIN = 6;
const NAME_FONT_STEP = 0.7;
const DATE_FONT_MIN = 5;

function nameFontSize(depth: number): number {
  return Math.max(NAME_FONT_MIN, NAME_FONT_MAX - depth * NAME_FONT_STEP);
}

function dateFontSize(depth: number): number {
  return Math.max(DATE_FONT_MIN, nameFontSize(depth) - 2);
}

/** Depth of the deepest branch currently loaded (0 = root only) -- used by
 * components/visuals/FanChart.tsx to detect "the tree just grew" (a fresh
 * "Increase depth" batch resolved) so it knows to re-fit the view instead
 * of preserving whatever pan/zoom was already showing. */
export function treeMaxDepth(node: TreeNode | null | undefined): number {
  if (!node?.children) return 0;
  return 1 + Math.max(treeMaxDepth(node.children[0]), treeMaxDepth(node.children[1]));
}

/** "Show lifespan" mode's px-per-year scale, and the floor/ceiling
 * around it -- MIN_THICKNESS keeps a short life (or an infant death)
 * visibly clickable rather than collapsing to a sliver; MAX_THICKNESS
 * guards against one bad/OCR'd date blowing up the whole chart. An 80-year
 * life comes out to 200px, comparable to RING's own 70px "one generation"
 * width in fixed mode, so switching modes doesn't wildly rescale the
 * chart. */
const PX_PER_YEAR = 2.5;
const MIN_THICKNESS = 20;
const MAX_THICKNESS = 320;

/** Pulls the first 4-digit year out of a profile date string -- these
 * arrive already display-formatted ("12 Jan 1982", "about 1900", "bef
 * 1875"; see treeData.ts's own TreePersonRaw doc comment), not a raw
 * GrampsDate struct with a numeric year field, so a regex is the only way
 * to get a year back out of one without a second API round-trip. Good
 * enough for a chart dimension, not meant to be exact. */
function extractYear(dateStr: string | undefined): number | null {
  const m = dateStr?.match(/\d{4}/);
  return m ? Number(m[0]) : null;
}

/** A wedge's radial thickness in "size by lifespan" mode: death year minus
 * birth year, clamped to [MIN_THICKNESS, MAX_THICKNESS] px. Falls back to
 * the fixed generation width (RING) whenever either date is missing or
 * unparsable, or the slot has no known person at all -- better than
 * guessing, and keeps an unresearched or partially-dated branch from
 * collapsing to nothing instead of just looking like fixed mode there. */
function lifespanThickness(node: TreeNode | null): number {
  const birthYear = extractYear(node?.person?.profile?.birth?.date);
  const deathYear = extractYear(node?.person?.profile?.death?.date);
  if (birthYear == null || deathYear == null || deathYear <= birthYear) return RING;
  return Math.min(MAX_THICKNESS, Math.max(MIN_THICKNESS, (deathYear - birthYear) * PX_PER_YEAR));
}

/** Same birth/death parsing as lifespanThickness, for the "Age at death"
 * color scheme -- kept separate since it has no MIN/MAX_THICKNESS clamp
 * (those exist for *layout*, a color scale wants the real extremes) and
 * applies regardless of whether "size by lifespan" is also on. */
function ageAtDeath(node: TreeNode | null): number | null {
  const birthYear = extractYear(node?.person?.profile?.birth?.date);
  const deathYear = extractYear(node?.person?.profile?.death?.date);
  return birthYear != null && deathYear != null && deathYear > birthYear ? deathYear - birthYear : null;
}

/** Smallest px gap between two adjacent tick labels the year axis will
 * allow -- drives niceYearStep below. A fixed *target tick count* (this
 * function's original approach) breaks down on a shallow tree: a small
 * totalYears still divided into ~6 ticks packs them at whatever spacing
 * falls out, with no floor -- exactly the overlapping-numerals mess a
 * short dome produced. Driving off a pixel floor instead means every tree
 * depth gets legible ticks, just fewer of them when the dome is small. */
const MIN_TICK_SPACING_PX = 92;

/** The smallest "nice" round year step (1/2/5 x a power of ten) whose own
 * px spacing (step * PX_PER_YEAR) clears MIN_TICK_SPACING_PX -- rounds
 * `minStepYears` (already converted from that px floor by the caller) UP
 * to the next nice number, the standard d3-axis "nice ticks" heuristic,
 * hand-rolled since this chart doesn't otherwise depend on d3-scale/
 * d3-axis. */
function niceYearStep(minStepYears: number): number {
  const clamped = Math.max(1, minStepYears);
  const mag = Math.pow(10, Math.floor(Math.log10(clamped)));
  const norm = clamped / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

interface Wedge {
  node: TreeNode | null;
  depth: number;
  a0: number;
  a1: number;
  innerR: number;
  outerR: number;
}

/** Walks the ahnentafel binary tree (TreeNode.children is always exactly
 * [father, mother] once a node has any -- see treeData.ts's ancestorNode)
 * as deep as the currently-loaded data goes, splitting the angular range in
 * half at each step (father keeps the first/left half, mother the second/
 * right half -- the same convention harrywind.nl's own tRange uses). Depth
 * is unbounded here -- it stops wherever `node.children` is unset, which is
 * exactly TreeNode's own two boundary shapes: a `{}` placeholder (no known
 * person at all, `includeEmpty`'s doc comment in treeData.ts) draws as the
 * hatched "no record" wedge; a known person with `hasMore` (real further
 * ancestors just not fetched past this depth yet) draws normally with a
 * bare outer edge -- TreeView.tsx's own "Increase depth" button (not
 * anything drawn here) is what fetches those and grows this tree. Different
 * branches routinely end up different depths once a few rounds of that have
 * happened -- expected, not a bug, the same way a box tree's boundary can
 * sit at different depths per branch.
 *
 * `thickness` decouples radial layout from depth entirely: fixed mode
 * passes a constant-RING function, "size by lifespan" mode passes
 * lifespanThickness -- either way each wedge's own outerR (= its child
 * wedges' innerR) is just its parent's outerR plus its own thickness, so
 * the same recursion produces both layouts with no other change. */
function collectWedges(
  node: TreeNode | undefined,
  depth: number,
  a0: number,
  a1: number,
  innerR: number,
  thickness: (node: TreeNode | null) => number,
  out: Wedge[],
): void {
  const n = node ?? null;
  const outerR = innerR + thickness(n);
  out.push({ node: n, depth, a0, a1, innerR, outerR });
  const kids = node?.children;
  if (!kids) return;
  const mid = (a0 + a1) / 2;
  collectWedges(kids[0], depth + 1, a0, mid, outerR, thickness, out);
  collectWedges(kids[1], depth + 1, mid, a1, outerR, thickness, out);
}

/** Caps how far "fit to window" will zoom IN for a very shallow tree (e.g.
 * just root + one generation) -- fitting a tiny dome to a large panel would
 * otherwise blow it up to an ungainly size. */
const MAX_FIT_SCALE = 2.5;
const FIT_PAD = 24;

/** The zoom transform that frames the *whole* currently-drawn dome within
 * bboxWidth x bboxHeight, root still anchored at its own BOTTOM_MARGIN line
 * rather than re-centered vertically -- same "anchor the root, don't center
 * the bounding box" instinct as the chart's own default framing, just with
 * a computed scale instead of a fixed 1:1 one (renderTreeChart's own doc
 * comment makes the same call, for the same reason). The dome's bounding
 * box is well-approximated by a half-disc of radius maxR (x in
 * [-maxR,maxR], y in [-maxR,0]) even when branches reach unevenly far,
 * since every wedge's angular span is still within the fixed -90..+90
 * domain -- generous enough for "fits in the window", not a tight bound.
 * Root (content (0,0)) already renders at its default screen position from
 * the svg's own viewBox alone (xOffset/yOffset below), with the zoom
 * transform at identity -- so `k=scale` with tx=ty=0 (zoomIdentity's own
 * defaults, untouched here) keeps it exactly there while changing only the
 * scale, since scaling never moves the origin. */
function computeFitTransform(wedges: Wedge[], bboxWidth: number, bboxHeight: number): ZoomTransform {
  const maxR = Math.max(RING, ...wedges.map((w) => w.outerR));
  const availWidth = Math.max(40, bboxWidth - 2 * FIT_PAD);
  const availHeight = Math.max(40, bboxHeight - FIT_PAD - BOTTOM_MARGIN);
  const scale = Math.min(availWidth / (2 * maxR), availHeight / maxR, MAX_FIT_SCALE);
  return zoomIdentity.scale(scale);
}

/** Click-to-center's own zoom cap/floor -- much more permissive than
 * MAX_FIT_SCALE (which bounds fitting the *whole dome*): a single clicked
 * wedge, especially several generations out, is routinely a small sliver of
 * the full chart, and the whole point of centering on it is to zoom in on
 * that detail. MIN_SLICE_ZOOM is mostly defensive (root's own wedge is the
 * one realistic case that zooms *out*, since it spans the full -90..+90 at
 * radius 0..RING). */
const MAX_SLICE_ZOOM = 8;
const MIN_SLICE_ZOOM = 0.4;
/** A tight fit (scale = exactly "wedge fills the padded panel") reads as
 * uncomfortably close -- there's no surrounding context left to see which
 * branch this even is. Applied to the raw fit scale before the MAX/MIN
 * clamp above, so those two stay true ceiling/floor values regardless of
 * this factor. */
const SLICE_ZOOM_HEADROOM = 0.55;

/** The content-space bounding box of one wedge, then the scale that fits it
 * (with FIT_PAD's own padding, backed off by SLICE_ZOOM_HEADROOM) within
 * bboxWidth x bboxHeight, and the box's own center to frame on. Checked
 * against all 4 corners (innerR/outerR x a0/a1, each mapped through the
 * same (r sinθ, -r cosθ) point formula collectWedges' own callers use) plus,
 * when the wedge's own angular span crosses θ=0, the point straight out at
 * (0, -outerR) -- the true topmost extent in that case, not captured by any
 * corner. */
function wedgeFrame(w: Wedge, bboxWidth: number, bboxHeight: number): { cx: number; cy: number; scale: number } {
  const point = (r: number, theta: number): [number, number] => [r * Math.sin(theta), -r * Math.cos(theta)];
  const pts: [number, number][] = [
    point(w.innerR, w.a0),
    point(w.outerR, w.a0),
    point(w.innerR, w.a1),
    point(w.outerR, w.a1),
  ];
  if (w.a0 <= 0 && w.a1 >= 0) pts.push([0, -w.outerR]);
  const xMin = Math.min(...pts.map((p) => p[0]));
  const xMax = Math.max(...pts.map((p) => p[0]));
  const yMin = Math.min(...pts.map((p) => p[1]));
  const yMax = Math.max(...pts.map((p) => p[1]));
  const availWidth = Math.max(40, bboxWidth - 2 * FIT_PAD);
  const availHeight = Math.max(40, bboxHeight - 2 * FIT_PAD);
  const rawScale = Math.min(availWidth / Math.max(1, xMax - xMin), availHeight / Math.max(1, yMax - yMin));
  return {
    cx: (xMin + xMax) / 2,
    cy: (yMin + yMax) / 2,
    scale: Math.min(MAX_SLICE_ZOOM, Math.max(MIN_SLICE_ZOOM, rawScale * SLICE_ZOOM_HEADROOM)),
  };
}

interface AxisData {
  maxR: number;
  ticks: { x: number; year: number }[];
  tickRadii: number[];
}

/** "Show lifespan" mode's year-axis geometry -- computed once and used
 * twice (renderFanChart draws the reference arcs from it *before* the
 * wedges, so they sit behind them, then the solid axis line/ticks/labels
 * after, so those stay readable on top). Null whenever there's nothing to
 * center it on (root's own birth year doesn't parse). */
function computeAxisData(ancestorTree: TreeNode | null, wedges: Wedge[]): AxisData | null {
  const rootBirthYear = extractYear(ancestorTree?.person?.profile?.birth?.date);
  if (rootBirthYear == null) return null;
  const maxR = Math.max(RING, ...wedges.map((d) => d.outerR));
  const totalYears = maxR / PX_PER_YEAR;
  const step = niceYearStep(MIN_TICK_SPACING_PX / PX_PER_YEAR);
  const ticks: { x: number; year: number }[] = [{ x: 0, year: rootBirthYear }];
  const tickRadii: number[] = [];
  for (let i = 1; i * step <= totalYears; i++) {
    const r = i * step * PX_PER_YEAR;
    tickRadii.push(r);
    ticks.push({ x: -r, year: rootBirthYear - i * step }, { x: r, year: rootBirthYear - i * step });
  }
  return { maxR, ticks, tickRadii };
}

export interface FanChartOptions {
  bboxWidth: number;
  bboxHeight: number;
  /** Read off the previous render's SVG (d3-zoom's `zoomTransform`) and
   * handed back in, so panning/zooming survives a resize, selection change,
   * or expand -- same convention as renderTreeChart's own `initialZoom`. */
  initialZoom?: ZoomTransform | null;
  /** A click *selects* a person, same "click selects, doesn't navigate" rule
   * as renderTreeChart's own onSelectPerson -- TreeView.tsx owns what
   * "selected" means (its shared PersonCard). */
  onSelectPerson?: (handle: string) => void;
  selectedHandle?: string | null;
  /** "Size wedges by lifespan" toggle (TreeView.tsx's own Checkbox) -- see
   * collectWedges' own doc comment on how this reaches the layout. */
  sizeByLifespan: boolean;
  /** "Generation"/"Age at death" (TreeView.tsx's own SegmentedControl) --
   * see fillFor/strokeFor below. */
  colorScheme: FanColorScheme;
  /** The handle to animate the view onto -- components/visuals/FanChart.tsx
   * sets this to whichever wedge was just clicked, the same "target,
   * independent of whether this render actually animates to it" split
   * renderTreeChart's own centerHandle/centerOnSelect makes. */
  centerHandle?: string | null;
  /** When true and `centerHandle` matches a currently-drawn wedge, the view
   * animates to frame that whole wedge -- centered, and zoomed to whatever
   * scale fits its own bounding box (wedgeFrame below), unlike
   * renderTreeChart's own centerOnSelect (a box tree's boxes are all the
   * same size, so there's nothing to zoom to fit). components/visuals/
   * FanChart.tsx sets this only on the render where the selection just
   * changed (a fresh click), not on every rebuild while it stays the
   * same. */
  centerOnSelect?: boolean;
}

/** Draws the ancestor fan into a fresh SVG sized to bboxWidth/bboxHeight and
 * returns it -- the caller (components/visuals/FanChart.tsx) owns inserting
 * and removing it from the DOM, same contract as renderTreeChart. Root sits
 * at the bottom-center with generations fanning upward into a half-circle
 * dome (angle -90°..+90° in d3-arc's own 0=north/clockwise convention),
 * matching the reference layout this is modeled on. */
export function renderFanChart(
  ancestorTree: TreeNode | null,
  {
    bboxWidth, bboxHeight, initialZoom, onSelectPerson, selectedHandle, sizeByLifespan, colorScheme,
    centerHandle, centerOnSelect,
  }: FanChartOptions,
): SVGSVGElement {
  const svg = create("svg").attr("font-family", "var(--mantine-font-family)").attr("font-size", 12);
  // Hover brightness, ported from harrywind's own `.wedge:hover path` rule
  // -- cheap enough to inline as a real `<style>` element (this SVG has no
  // other stylesheet) rather than reproduce in JS.
  svg.append("style").text(".wedge:hover path{filter:brightness(1.08)}");
  const defs = svg.append("defs");

  // Unknown-ancestor placeholder fill: a faint diagonal hatch (same idea as
  // harrywind's own `#hatch` pattern) rather than leaving the slot blank, so
  // the chart still shows the *shape* of an unresearched branch.
  defs
    .append("pattern")
    .attr("id", "fan-hatch")
    .attr("width", 6)
    .attr("height", 6)
    .attr("patternTransform", "rotate(45)")
    .attr("patternUnits", "userSpaceOnUse")
    .call((g) => {
      g.append("rect").attr("width", 6).attr("height", 6).attr("fill", "var(--mantine-color-body)");
      g.append("line")
        .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6)
        .attr("stroke", "var(--mantine-color-default-border)")
        .attr("stroke-width", 2);
    });

  const chartContent = svg.append("g").attr("id", "fan-chart-content");

  // Root (content (0,0)) always renders at exactly (transform.x,
  // transform.y) on screen -- scaling doesn't move the origin -- so
  // clamping ty to a floor of 0 is exactly "root can't be dragged above its
  // default resting line" (BOTTOM_MARGIN's own position), with x and k
  // (zoom level) left completely free. Below that floor there's nothing
  // drawn (the dome only grows upward from root), so dragging past it would
  // otherwise just reveal blank panel background under the chart. Forcing
  // the internal `__zoom` to match (not just the DOM attr) keeps the next
  // drag frame's delta computed from the clamped position too -- a hard
  // stop, not a rubber-band lag -- same direct-`__zoom`-write technique
  // renderTreeChart's own initialZoom restore already uses below.
  const zoomBehavior = zoom<SVGSVGElement, undefined>().on("zoom", (e) => {
    let t = e.transform;
    if (t.y < 0) {
      t = t.translate(0, -t.y / t.k);
      (svg.node() as unknown as { __zoom: ZoomTransform }).__zoom = t;
    }
    chartContent.attr("transform", t.toString());
  });
  svg.call(zoomBehavior);

  const thickness = sizeByLifespan ? lifespanThickness : () => RING;
  const wedges: Wedge[] = [];
  if (ancestorTree) collectWedges(ancestorTree, 0, -Math.PI / 2, Math.PI / 2, 0, thickness, wedges);

  const axisData = sizeByLifespan ? computeAxisData(ancestorTree, wedges) : null;

  // The reference arcs draw *before* the wedge group below, so they sit
  // behind the wedges (a `<circle>`/`<path>` painted later covers one
  // painted earlier in SVG's own painter's-algorithm order) rather than
  // dashing across their fill -- the axis line/ticks/labels themselves stay
  // on top, drawn later, since those need to stay readable as an overlay.
  // A faint dashed reference arc at each tick's own radius, spanning the
  // whole dome -- so a wedge far from the x-axis can still be read against
  // the year scale, not just the two wedges the tick label itself sits
  // under. Same idea (and stroke-dasharray) as harrywind's own
  // `.refCircle`. Degenerate innerRadius=outerRadius arc -- a d3-shape
  // idiom for "just the curve", since arc() otherwise draws a filled
  // annular sector.
  if (axisData) {
    const refArc = d3arc<number>()
      .innerRadius((r) => r)
      .outerRadius((r) => r)
      .startAngle(-Math.PI / 2)
      .endAngle(Math.PI / 2);
    chartContent
      .append("g")
      .attr("class", "ref-circles")
      .selectAll("path.ref-circle")
      .data(axisData.tickRadii)
      .join("path")
      .attr("class", "ref-circle")
      .attr("d", (r) => refArc(r))
      .attr("fill", "none")
      .attr("stroke", "var(--mantine-color-dimmed)")
      .attr("stroke-width", 1.2)
      .attr("stroke-dasharray", "1.5,3.5")
      .style("pointer-events", "none");
  }

  // "Age at death" scheme's own scale -- built from the currently-loaded
  // wedges' own extent, same as harrywind's own rebuildModel does each time
  // its data changes (a deeper "Increase depth" click widens the extent, so
  // this is recomputed on every render rather than once).
  const deathAges = wedges.map((w) => ageAtDeath(w.node)).filter((a): a is number => a != null);
  const deathLo = deathAges.length > 0 ? Math.min(...deathAges) : 0;
  const deathHi = deathAges.length > 0 ? Math.max(...deathAges) : 0;
  const deathColorFor = (age: number): string =>
    deathHi > deathLo ? threeStopGradient(DEATH_COLORS, (age - deathLo) / (deathHi - deathLo)) : DEATH_COLORS[1];

  // No Mantine-token fallback for "no data for this scheme" (a known person
  // missing a birth or death date) -- unlike the hatch pattern, which means
  // "no person at all" -- so it reads as a distinct, deliberately neutral
  // grey rather than either an accent color or the hatch's "unresearched"
  // texture.
  const NO_SCHEME_DATA = "#c9c2b3";

  const fillFor = (d: Wedge): string => {
    if (!d.node?.person) return "url(#fan-hatch)";
    if (colorScheme === "death") {
      const age = ageAtDeath(d.node);
      return age != null ? deathColorFor(age) : NO_SCHEME_DATA;
    }
    return genFill(d.depth);
  };
  const strokeBaseFor = (d: Wedge): string => {
    if (!d.node?.person) return "var(--mantine-color-default-border)";
    if (colorScheme === "death") {
      const age = ageAtDeath(d.node);
      return age != null ? darken(deathColorFor(age)) : darken(NO_SCHEME_DATA);
    }
    return genStroke(d.depth);
  };

  const arcGen = d3arc<Wedge>()
    .innerRadius((d) => d.innerR)
    .outerRadius((d) => Math.max(d.innerR + 1, d.outerR - 1))
    .startAngle((d) => d.a0)
    .endAngle((d) => d.a1)
    // GAP_PX / outerR converts the constant target gap into whatever angle
    // sweeps that many px at *this* wedge's own outer radius -- a deep,
    // narrow wedge gets a tiny padAngle, a shallow wide one a larger one,
    // so the drawn gap reads the same width everywhere. Capped at
    // MAX_PAD_ANGLE so a very-small-radius wedge (root, or an early
    // generation) never has the pad eat a chunk of its own angular span.
    .padAngle((d) => Math.min(MAX_PAD_ANGLE, GAP_PX / Math.max(1, d.outerR)))
    .cornerRadius(CORNER_RADIUS);

  const group = chartContent
    .append("g")
    .selectAll("g.wedge")
    .data(wedges)
    .join("g")
    .attr("class", "wedge")
    .style("cursor", (d) => (d.node?.person ? "pointer" : "default"))
    .on("click", (event, d) => {
      if (d.node?.person) {
        event.stopPropagation();
        onSelectPerson?.(d.node.person.handle);
      }
    });

  group
    .append("path")
    .attr("d", (d) => arcGen(d))
    .attr("fill", (d) => fillFor(d))
    .attr("stroke", (d) => (d.node?.person?.handle === selectedHandle ? "var(--mantine-color-text)" : strokeBaseFor(d)))
    .attr("stroke-width", (d) => (d.node?.person?.handle === selectedHandle ? 2.5 : 1.5));

  const withPerson = group.filter((d) => !!d.node?.person);

  withPerson
    .append("title")
    .text((d) => [d.node!.person!.profile?.name_given, d.node!.person!.profile?.name_surname].filter(Boolean).join(" ") || "(unnamed person)");

  // Root gets a plain upright label (it's not meaningfully "along a radius"
  // -- it's the center point) -- placed at half its own wedge's own height
  // rather than at y=0 (the flat bottom edge), so it reads as sitting
  // inside root's own area rather than pinned to the very bottom of the
  // panel. Every other ring gets a label rotated to run *tangentially* --
  // perpendicular to the center-to-edge line through its own mid-angle,
  // i.e. following the ring's own curve, the way
  // harrywind.nl's own labels do. `rotate(θ-90) translate(midR,0)` is the
  // *positioning* step alone -- it's what puts the label group's own origin
  // at the wedge's actual midpoint (θ-90 is the local rotation whose
  // "local +x" happens to point radially at that spot, which is what makes
  // `translate(midR,0)` walk out along the radius rather than sideways) --
  // ported over unchanged from this label's original radial version. The
  // trailing `rotate(90)` is the only thing that actually changes reading
  // direction: applied *after* the translate, it re-orients the local frame
  // around the point already placed, without moving it, from "local +x
  // reads radially" to "local +x reads tangentially" (a further 90°
  // clockwise turn: (sinθ,-cosθ) -> (cosθ,sinθ)). No conditional flip
  // needed anywhere in this chart's -90..+90 domain (unlike a full-circle
  // sunburst's usual radial-label idiom, which does need one): that tangent
  // direction (cosθ, sinθ) is exactly the direction of increasing θ -- the
  // father-to-mother reading order the wedges are already laid out in -- so
  // it stays upright and consistently ordered from the west edge, through
  // top-center, to the east edge with no discontinuity to correct for.
  const labelGroup = withPerson.append("g").attr("transform", (d) => {
    if (d.depth === 0) return `translate(0,${-(d.innerR + d.outerR) / 2})`;
    const thetaDeg = (((d.a0 + d.a1) / 2) * 180) / Math.PI;
    const midR = (d.innerR + d.outerR) / 2;
    return `rotate(${thetaDeg - 90}) translate(${midR},0) rotate(90)`;
  });

  const labelWidth = (d: Wedge): number =>
    d.depth === 0 ? (d.outerR - d.innerR) * 1.6 : Math.max(30, (d.a1 - d.a0) * ((d.innerR + d.outerR) / 2) - 8);

  labelGroup
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .attr("y", -6)
    .attr("fill", "var(--mantine-color-text)")
    .attr("font-size", (d) => nameFontSize(d.depth))
    .attr("font-weight", 600)
    .text((d) => {
      const p = d.node!.person!;
      return nameLabel(p.profile?.name_given, p.profile?.name_surname, labelWidth(d), nameFontSize(d.depth));
    });

  labelGroup
    .append("text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .attr("y", 8)
    // Fixed dark tone rather than var(--mantine-color-dimmed): the wedges'
    // own fills (GEN_COLORS/DEATH_COLORS above) are the same hex in both
    // themes, but dimmed is a theme-relative gray that goes light-on-light
    // in dark mode -- too low-contrast against these mid-toned fills.
    .attr("fill", "rgba(0, 0, 0, 0.65)")
    .attr("font-size", (d) => dateFontSize(d.depth))
    .text((d) => {
      const p = d.node!.person!;
      return clipString(p.profile?.birth?.date ? `*${p.profile.birth.date}` : "", labelWidth(d), dateFontSize(d.depth));
    });

  // Lifespan mode's own year axis: a horizontal rule at y=0 (root's own
  // line -- the same line the pan clamp above keeps anchored near the
  // bottom of the panel), centered on root's own birth year, using the
  // exact same PX_PER_YEAR scale lifespanThickness already draws wedges
  // with. It's a rough reference, not a precise per-branch calendar axis --
  // an individual wedge's own radius is the sum of that lineage's own
  // ancestors' lifespans, which only tracks elapsed calendar time loosely
  // (overlapping lifespans, generation-gap differences) -- good enough to
  // orient by, not meant to line up exactly with any one wedge's boundary.
  // The reference arcs at these same tick radii were already drawn *before*
  // the wedges, above (axisData's own doc comment). Lives in `chartContent`
  // like everything else here, so it pans and scales with the wedges rather
  // than staying pinned to the viewport.
  if (axisData) {
    const axisG = chartContent.append("g").attr("class", "year-axis");

    axisG
      .append("line")
      .attr("x1", -axisData.maxR)
      .attr("x2", axisData.maxR)
      .attr("y1", 0)
      .attr("y2", 0)
      .attr("stroke", "var(--mantine-color-dimmed)")
      .attr("stroke-width", 1.5);

    const tickG = axisG
      .selectAll("g.tick")
      .data(axisData.ticks)
      .join("g")
      .attr("class", "tick")
      .attr("transform", (d) => `translate(${d.x},0)`);

    tickG.append("line").attr("y1", -4).attr("y2", 4).attr("stroke", "var(--mantine-color-dimmed)");

    tickG
      .append("text")
      .attr("y", 19)
      .attr("text-anchor", "middle")
      .attr("font-size", 13)
      .attr("fill", "var(--mantine-color-text)")
      .text((d) => String(d.year));
  }

  const xOffset = -bboxWidth / 2;
  const yOffset = -(bboxHeight - BOTTOM_MARGIN);
  svg.attr("viewBox", `${xOffset} ${yOffset} ${bboxWidth} ${bboxHeight}`);
  svg.attr("width", bboxWidth).attr("height", bboxHeight);

  // Three cases, in priority order -- mirrors renderTreeChart's own
  // initialZoom/centerOnSelect split:
  //  1. A fresh click just selected a wedge (FanChart.tsx's own
  //     "justSelected") -- animate from wherever the view already was to
  //     frame that whole wedge: centered, and zoomed to whatever scale fits
  //     its own bounding box (wedgeFrame). Root is the one exception: its
  //     own wedge is a thin center sliver, and "focus on root" reads as
  //     "back out to the overview" rather than "zoom into this" -- so a
  //     root click animates to the same whole-dome fit computeFitTransform
  //     gives the initial-draw case, the fan chart's equivalent of a
  //     "reset view" / breadcrumb-home click.
  //  2. No `initialZoom` at all -- FanChart.tsx only omits it on a fresh
  //     root, once the tree's just grown deeper (treeMaxDepth), or a "Size
  //     by lifespan" flip, so this is "fit the whole dome to the window."
  //  3. Otherwise, just restore whatever pan/zoom was already showing.
  const centerTarget = centerHandle ? wedges.find((w) => w.node?.person?.handle === centerHandle) : undefined;
  if (centerOnSelect && centerTarget) {
    if (initialZoom) {
      (svg.node() as unknown as { __zoom: ZoomTransform }).__zoom = initialZoom;
      chartContent.attr("transform", initialZoom.toString());
    }
    let centered: ZoomTransform;
    if (centerTarget.depth === 0) {
      centered = computeFitTransform(wedges, bboxWidth, bboxHeight);
    } else {
      const { cx, cy, scale } = wedgeFrame(centerTarget, bboxWidth, bboxHeight);
      // The svg-user-space point that the viewBox itself (xOffset/yOffset
      // above) maps to the panel's literal visual center -- *not*
      // (bboxWidth/2, bboxHeight/2) directly, since that pair is already
      // screen pixels and the viewBox has its own offset baked in (root's
      // default position is svg-space (0,0), not the panel's visual center
      // -- see BOTTOM_MARGIN's own doc comment on why). xOffset's own
      // contribution always cancels to 0 given xOffset = -bboxWidth/2.
      const svgCenterY = BOTTOM_MARGIN - bboxHeight / 2;
      centered = zoomIdentity.translate(0, svgCenterY).scale(scale).translate(-cx, -cy);
    }
    // Start from wherever the view already was and animate *from* there --
    // without the initialZoom restore just above, this would interpolate
    // from identity instead, a visible snap-then-slide on the very first
    // select (same pitfall renderTreeChart's own doc comment flags).
    svg.transition().duration(300).call(zoomBehavior.transform, centered);
  } else if (initialZoom) {
    (svg.node() as unknown as { __zoom: ZoomTransform }).__zoom = initialZoom;
    chartContent.attr("transform", initialZoom.toString());
  } else {
    const fit = computeFitTransform(wedges, bboxWidth, bboxHeight);
    (svg.node() as unknown as { __zoom: ZoomTransform }).__zoom = fit;
    chartContent.attr("transform", fit.toString());
  }

  return svg.node()!;
}
