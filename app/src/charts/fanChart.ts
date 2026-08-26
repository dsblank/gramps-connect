// Ancestor fan chart (View > Tree's "Fan" chart style) -- a radial sibling to
// treeChart.ts's box tree, sharing its overall shape (imperative d3, one SVG
// built and returned per render, d3-zoom for pan/zoom, `var(--mantine-...)`
// tokens for most chrome) but a completely different layout: a full 360°
// circle split by the father/mother binary already baked into
// TreeNode.children ([father, mother], see treeData.ts's ancestorNode)
// rather than d3-hierarchy's tree() layout -- root sits at the panel's own
// visual center, a full disc at its own radius, with each generation
// beyond it splitting the remaining circle in half again (so a parent
// fills an entire half-circle, a grandparent a quarter, and so on), not
// the half-dome (-90°..+90°) shape an ahnentafel fan chart more typically
// uses -- doubling the angular room every generation gets reads better at
// depth than the extra "which way is up" orientation cost, for this app's
// own tree sizes. Two color schemes (Generation, Age at death), ported
// from harrywind.nl's own reference implementation -- see GEN_COLORS/
// DEATH_COLORS -- plus an optional "size by lifespan" radial mode ported
// instead from a fanchart.py a Gramps discourse contributor shared
// (nodeRadii/computeYearScale below): every wedge's own inner/outer radius
// is that person's own death/birth year on a shared today-anchored scale,
// independent of its parent's position, so overlapping generations (a
// child is almost always born while their parent is still alive) draw as
// genuinely overlapping wedges rather than a nested ring per generation --
// legible because paint order is ascending by depth (root under, oldest
// ancestors on top) combined with each generation's angular span always
// being a proper subset of its own child's, not any special-cased shape.
import { arc as d3arc } from "d3-shape";
import { create, select } from "d3-selection";
import "d3-transition";
import { zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";
import type { TreeNode, TreePersonRaw } from "../store/treeData";

const RING = 70;
/** The parent-inherited edge's own inset, per generation -- edgeInset's own
 * doc comment on why a flat amount here is enough to guarantee nesting
 * without needing to track/grow anything across levels, and why it doesn't
 * bias a wedge's own center angle despite only ever touching one edge.
 * Deliberately *not* used for the edge a wedge shares with its own sibling
 * -- see collectWedges' own insetSide split, which leaves that edge exactly
 * at the raw midpoint instead: the two siblings share that boundary line
 * outright, separated only by their own strokes, per feedback that they
 * should be "almost touching" and could just "share that inside line
 * between them". */
export const PER_GEN_INSET_RAD = (1 * Math.PI) / 180;
/** Floor under a wedge's own *rendered* angular width -- edgeInset's own
 * ceiling keeps the parent-inherited edge's inset from eating past this, so
 * a wedge can shrink toward a sliver at extreme depth but never invert to a
 * negative span. */
export const MIN_RENDERED_WIDTH_RAD = (0.5 * Math.PI) / 180;

const CORNER_RADIUS = 2;

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

/** The native-tooltip text for one wedge's own `<title>` -- name plus
 * birth/death dates when known, so hovering a wedge too small to carry its
 * own on-wedge text (hasRoomForLabel's own doc comment) still surfaces who
 * it is and when they lived. `\n` renders as a real line break in every
 * major browser's own title tooltip. */
function personTooltip(p: TreePersonRaw): string {
  const name = [p.profile?.name_given, p.profile?.name_surname].filter(Boolean).join(" ") || "(unnamed person)";
  const birth = p.profile?.birth?.date;
  const death = p.profile?.death?.date;
  const dates = [birth ? `b. ${birth}` : null, death ? `d. ${death}` : null].filter(Boolean).join(", ");
  return dates ? `${name}\n${dates}` : name;
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

/** MIN_THICKNESS keeps a short life (or an infant death) visibly clickable
 * rather than collapsing to a sliver -- not part of the reference port
 * below, just a defensive floor on top of it. */
const MIN_THICKNESS = 20;
/** The fixed logical radius the *oldest currently-loaded* ancestor's own
 * birth year is scaled to land on -- see computeYearScale's own doc
 * comment. Arbitrary in absolute terms (computeFitTransform's own
 * zoom-to-fit rescales the whole circle to the panel regardless), chosen
 * just to be comfortably larger than RING * a typical loaded depth so
 * fixed and lifespan modes feel similarly sized at a glance. */
const CHART_MAX_RADIUS = 640;
/** Floor under how far back computeYearScale's own min-birth-year scan
 * will look -- not in the reference port (its CSV input is presumably
 * already reasonable), added here since extractYear can occasionally grab
 * the wrong 4 digits out of a garbled date string, and a single such
 * outlier would otherwise compress the *entire* chart's scale to fit it. */
const MAX_YEARS_BACK = 400;

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

/** The calendar axis's own scale: r=0 is *today*, not the root's own birth
 * year -- the only anchor that lets a still-living root (or ancestor)
 * reach the center rather than needing negative radius for "now". */
function currentYear(): number {
  return new Date().getFullYear();
}

/** True only for a known person with *both* a parseable birth and death
 * year -- the only case nodeRadii places by real calendar math below.
 * Deliberately narrower than "not still living": a missing death date
 * ordinarily means "presumed still living" for gramps-web's own alive-name-
 * privacy purposes, but that's a separate question from what to draw here,
 * and not one this function answers yet -- see fillFor's own doc comment.
 * For now, anyone missing either date -- including a plausibly-alive person
 * with no recorded death -- falls back to the same fixed-width placeholder
 * an empty {} slot gets, so calendar-anchored mode only ever draws (and
 * only needs verifying against the axis on) wedges backed by two real
 * years. */
function hasFullLifespan(node: TreeNode | null): boolean {
  return (
    extractYear(node?.person?.profile?.birth?.date) != null &&
    extractYear(node?.person?.profile?.death?.date) != null
  );
}

/** Ported from a Gramps-discourse-contributed fanchart.py's own
 * `outer_radius`/`inner_radius` normalization: rather than a fixed
 * px-per-year constant, the scale is *derived* each render from the
 * currently-loaded tree itself, so that the oldest currently-loaded
 * ancestor's own birth year lands exactly on CHART_MAX_RADIUS -- a 3-
 * generation tree and a 10-generation tree both fill the same logical
 * radius; "Increase depth" loading more/older ancestors just makes every
 * wedge's own scale finer, not the circle bigger. Walks the same
 * hasFullLifespan nodes nodeRadii itself will actually place by calendar
 * math (an unresearched or partially-dated branch can't skew the shared
 * scale), floors the oldest of their birth years to the nearest decade
 * (the reference's own `min_ref_year`) the same way the year-axis ticks
 * below land on round numbers, and never looks back further than
 * MAX_YEARS_BACK regardless of what the data says. Null when nothing
 * loaded yet has a full lifespan to scale by (computeAxisData mirrors this
 * null case the same way it always has). */
function computeYearScale(ancestorTree: TreeNode | null): { minRefYear: number; pxPerYear: number } | null {
  const years: number[] = [];
  const walk = (node: TreeNode | null | undefined): void => {
    if (!node) return;
    if (hasFullLifespan(node)) years.push(extractYear(node.person!.profile!.birth!.date)!);
    node.children?.forEach(walk);
  };
  walk(ancestorTree);
  if (years.length === 0) return null;
  const now = currentYear();
  const oldest = Math.max(now - MAX_YEARS_BACK, Math.min(...years));
  const minRefYear = Math.floor(oldest / 10) * 10;
  const totalYears = Math.max(1, now - minRefYear);
  return { minRefYear, pxPerYear: CHART_MAX_RADIUS / totalYears };
}

function yearToRadius(year: number, pxPerYear: number): number {
  return Math.max(0, currentYear() - year) * pxPerYear;
}

/** "Size by lifespan" mode's radius for one wedge -- computed straight from
 * that person's *own* birth/death years against the shared today-anchored
 * scale (computeYearScale's own `pxPerYear`, threaded down from
 * renderFanChart), independent of its parent wedge's own position: outerR
 * (farther from center = further back in time) is the birth year's own
 * radius, innerR (closer to center = more recent) is the death year's own
 * radius. Because an ancestor is essentially always still alive when their
 * own child is born, a parent's innerR routinely lands at a *smaller*
 * radius than their child's own outerR -- the two wedges genuinely overlap
 * on the calendar axis, same as their real lives did. The reference's own
 * fix for that isn't a taper -- it's paint order: renderFanChart draws
 * ascending by depth (root first/bottom, oldest ancestors last/top), and
 * since every ancestor's own angular slice is a proper *subset* of their
 * descendant's (the same recursive halving collectWedges always did), an
 * ancestor drawn on top only ever covers its own narrower slice of its
 * descendant -- the descendant stays visible everywhere outside that
 * slice, no artificial narrowing required. `fallbackInnerR` -- the calling
 * child's own outerR, the same "stack from where the descendant left off"
 * fallback fixed mode always uses -- kicks in whenever hasFullLifespan is
 * false: an empty {} placeholder, or a known person missing either date,
 * so this function is never asked to guess at a radius from a single known
 * year. */
function nodeRadii(
  node: TreeNode | null,
  fallbackInnerR: number,
  pxPerYear: number,
): { innerR: number; outerR: number } {
  if (!hasFullLifespan(node)) return { innerR: fallbackInnerR, outerR: fallbackInnerR + RING };
  const outerR = yearToRadius(extractYear(node!.person!.profile!.birth!.date)!, pxPerYear);
  const rawInnerR = yearToRadius(extractYear(node!.person!.profile!.death!.date)!, pxPerYear);
  const innerR = Math.max(0, Math.min(rawInnerR, outerR - MIN_THICKNESS));
  return { innerR, outerR: Math.max(outerR, innerR + MIN_THICKNESS) };
}

/** Same birth/death parsing as nodeRadii, for the "Age at death" color
 * scheme -- kept separate since it has no MIN_THICKNESS clamp (that exists
 * for *layout*, a color scale wants the real extremes) and applies
 * regardless of whether "size by lifespan" is also on. */
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
 * short circle produced. Driving off a pixel floor instead means every
 * tree depth gets legible ticks, just fewer of them when the circle is
 * small. */
const MIN_TICK_SPACING_PX = 92;

/** The smallest "nice" round year step (1/2/5 x a power of ten) whose own
 * px spacing (step * pxPerYear) clears MIN_TICK_SPACING_PX -- rounds
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

// Exported for __tests__/fanChart.test.ts, which checks the angular
// geometry directly (siblings meet exactly at their parent's own rendered
// center, every wedge nests strictly inside its parent, no inversion at
// depth) rather than by eyeballing screenshots -- see that file's own doc
// comment for why.
export interface Wedge {
  node: TreeNode | null;
  depth: number;
  /** This wedge's own raw angular allotment, inherited unchanged from
   * whichever side of its *parent's rendered* [drawA0,drawA1] split it
   * came from (collectWedges' own doc comment) -- i.e. already reflects
   * every ancestor's own inset, just not this node's. */
  a0: number;
  a1: number;
  /** The *rendered* angular bounds actually passed to arcGen -- a subset of
   * [a0,a1], insetting only the edge this wedge inherits from its own
   * parent (edgeInset's own doc comment); the edge it shares with its
   * sibling is left exactly at the raw midpoint (a "father" keeps its own
   * a1 unchanged as drawA1, a "mother" keeps a0 unchanged as drawA0), so
   * two siblings meet exactly, separated only by their own strokes. Equal
   * to a0/a1 outright for the root, which has no parent edge to inset
   * from. */
  drawA0: number;
  drawA1: number;
  innerR: number;
  outerR: number;
}

/** The parent-inherited edge's own inset for one wedge, given its raw
 * angular width -- a flat amount (PER_GEN_INSET_RAD), clamped so it can't
 * eat past MIN_RENDERED_WIDTH_RAD of the wedge's own rendered span. Looks
 * like it should need to *grow* with depth to keep a child from rendering
 * outside its own parent -- an earlier version threaded exactly that kind
 * of cumulative value through the recursion -- but it doesn't: each child's
 * raw [a0,a1] (the input to this function) is already a sub-range of its
 * parent's own *rendered* bounds (collectWedges splits children at the
 * parent's rendered center, not its raw one), so inserting any positive
 * amount off an already-contained sub-range keeps it contained, with no
 * cross-generation bookkeeping required. That parent/rendered-center split
 * is also what keeps a wedge's own center angle from drifting even though
 * only one of its two edges ever gets inset: a child's own two edges start
 * from its parent's *actual drawn* midpoint, not the parent's differently-
 * placed raw one, so nothing to correct for downstream. */
export function edgeInset(rawWidth: number): number {
  return Math.min(PER_GEN_INSET_RAD, Math.max(0, rawWidth - MIN_RENDERED_WIDTH_RAD));
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
 * `radiiFor` decouples radial layout from depth entirely: fixed mode just
 * stacks a constant RING width off the running radius, "size by lifespan"
 * mode (nodeRadii) computes each wedge's own radii from its own dates
 * instead, only falling back to the running radius when a date's missing
 * -- either way the same recursion produces both layouts with no other
 * change, and each node's own outerR is still what its own two children
 * get passed down as *their* fallback radius.
 *
 * `insetSide` says which of *this* node's two edges it inherited from its
 * own parent -- "a0" for a father, "a1" for a mother, "none" for the root
 * (which has no parent edge at all, so neither side insets). Children are
 * split at `(drawA0+drawA1)/2` -- this node's own *rendered* center, not
 * `(a0+a1)/2` -- which is what makes edgeInset's "just don't invert your
 * own wedge" guarantee sufficient for containment on its own.
 *
 * `applyInset` is fixed mode's own escape hatch: false forces every inset
 * to 0 (drawA0/drawA1 always equal a0/a1), so fixed mode's rings stay the
 * classic edge-to-edge annular sectors they always were -- the nesting
 * problem edgeInset solves is specific to calendar-anchored mode's
 * genuinely-overlapping radii (nodeRadii's own doc comment); fixed mode's
 * generations never overlap in the first place, so there's nothing for an
 * inset to fix and no reason to give up the flush look for it. */
export function collectWedges(
  node: TreeNode | undefined,
  depth: number,
  a0: number,
  a1: number,
  insetSide: "a0" | "a1" | "none",
  fallbackInnerR: number,
  radiiFor: (node: TreeNode | null, fallbackInnerR: number) => { innerR: number; outerR: number },
  applyInset: boolean,
  out: Wedge[],
): void {
  const n = node ?? null;
  const { innerR, outerR } = radiiFor(n, fallbackInnerR);
  const inset = insetSide === "none" || !applyInset ? 0 : edgeInset(a1 - a0);
  const drawA0 = insetSide === "a0" ? a0 + inset : a0;
  const drawA1 = insetSide === "a1" ? a1 - inset : a1;
  out.push({ node: n, depth, a0, a1, drawA0, drawA1, innerR, outerR });
  const kids = node?.children;
  if (!kids) return;
  const mid = (drawA0 + drawA1) / 2;
  collectWedges(kids[0], depth + 1, drawA0, mid, "a0", outerR, radiiFor, applyInset, out);
  collectWedges(kids[1], depth + 1, mid, drawA1, "a1", outerR, radiiFor, applyInset, out);
}

/** Caps how far "fit to window" will zoom IN for a very shallow tree (e.g.
 * just root + one generation) -- fitting a tiny circle to a large panel
 * would otherwise blow it up to an ungainly size. */
const MAX_FIT_SCALE = 2.5;
const FIT_PAD = 24;

/** The zoom transform that frames the *whole* currently-drawn circle within
 * bboxWidth x bboxHeight, root re-centered in the panel -- a computed scale
 * instead of a fixed 1:1 one (renderTreeChart's own doc comment makes the
 * same call, for the same reason). The bounding box is a full disc of
 * radius maxR (x and y both in [-maxR,maxR]), so both dimensions divide by
 * `2*maxR`. Root (content (0,0)) already renders at its default screen
 * position from the svg's own viewBox alone (xOffset/yOffset below), with
 * the zoom transform at identity -- so `k=scale` with tx=ty=0
 * (zoomIdentity's own defaults, untouched here) keeps it exactly there
 * while changing only the scale, since scaling never moves the origin. */
function computeFitTransform(wedges: Wedge[], bboxWidth: number, bboxHeight: number): ZoomTransform {
  const maxR = Math.max(RING, ...wedges.map((w) => w.outerR));
  const availWidth = Math.max(40, bboxWidth - 2 * FIT_PAD);
  const availHeight = Math.max(40, bboxHeight - 2 * FIT_PAD);
  const scale = Math.min(availWidth / (2 * maxR), availHeight / (2 * maxR), MAX_FIT_SCALE);
  return zoomIdentity.scale(scale);
}

/** Click-to-center's own zoom cap/floor -- much more permissive than
 * MAX_FIT_SCALE (which bounds fitting the *whole circle*): a single clicked
 * wedge, especially several generations out, is routinely a small sliver of
 * the full chart, and the whole point of centering on it is to zoom in on
 * that detail. MIN_SLICE_ZOOM is mostly defensive (root's own wedge is the
 * one realistic case that zooms *out*, since it spans the full circle at
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
 * for each of the 4 cardinal directions (top/right/bottom/left) the wedge's
 * own angular span crosses, that direction's own true extremum at outerR --
 * not captured by any corner. A wide top-level wedge (root's own two
 * children each span a full 180°) routinely crosses 2-3 of the 4 cardinal
 * directions, unlike a half-dome layout's own top-only case. */
function wedgeFrame(w: Wedge, bboxWidth: number, bboxHeight: number): { cx: number; cy: number; scale: number } {
  const point = (r: number, theta: number): [number, number] => [r * Math.sin(theta), -r * Math.cos(theta)];
  const pts: [number, number][] = [
    point(w.innerR, w.a0),
    point(w.outerR, w.a0),
    point(w.innerR, w.a1),
    point(w.outerR, w.a1),
  ];
  for (const cardinal of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    if (w.a0 <= cardinal && w.a1 >= cardinal) pts.push(point(w.outerR, cardinal));
  }
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
 * after, so those stay readable on top). Centered on *today* (currentYear),
 * the same r=0 anchor nodeRadii uses -- not the root's own birth year -- so
 * this is a real, exact calendar scale: any wedge's own inner/outer edge
 * lines up with its actual death/birth year read straight off this axis.
 * `maxR` is just CHART_MAX_RADIUS itself now (computeYearScale's own doc
 * comment): by construction the oldest currently-loaded, fully-dated
 * wedge's own outerR lands there, not some looser bound recomputed from
 * `wedges`. */
function computeAxisData(pxPerYear: number): AxisData {
  const maxR = CHART_MAX_RADIUS;
  const totalYears = maxR / pxPerYear;
  const step = niceYearStep(MIN_TICK_SPACING_PX / pxPerYear);
  const nowYear = currentYear();
  const ticks: { x: number; year: number }[] = [{ x: 0, year: nowYear }];
  const tickRadii: number[] = [];
  for (let i = 1; i * step <= totalYears; i++) {
    const r = i * step * pxPerYear;
    tickRadii.push(r);
    ticks.push({ x: -r, year: nowYear - i * step }, { x: r, year: nowYear - i * step });
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
 * at the panel's own center as a full disc, with each generation beyond it
 * splitting the remaining full circle in half again (angle -180°..+180° in
 * d3-arc's own 0=north/clockwise convention) -- see this file's own header
 * comment on why a full circle rather than the more typical half-dome
 * ahnentafel layout. */
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

  // Root (content (0,0)) sits at the panel's own visual center (xOffset/
  // yOffset below), with the chart free to pan in every direction -- no
  // resting-line floor to clamp against, unlike a half-dome layout's own
  // root-anchored-at-the-bottom convention.
  const zoomBehavior = zoom<SVGSVGElement, undefined>().on("zoom", (e) => {
    chartContent.attr("transform", e.transform.toString());
  });
  svg.call(zoomBehavior);

  const yearScale = sizeByLifespan ? computeYearScale(ancestorTree) : null;
  const radiiFor: (node: TreeNode | null, fallbackInnerR: number) => { innerR: number; outerR: number } = yearScale
    ? (n, fallbackInnerR) => nodeRadii(n, fallbackInnerR, yearScale.pxPerYear)
    : (n, fallbackInnerR) => ({ innerR: fallbackInnerR, outerR: fallbackInnerR + RING });
  const wedges: Wedge[] = [];
  if (ancestorTree) {
    collectWedges(ancestorTree, 0, -Math.PI, Math.PI, "none", 0, radiiFor, sizeByLifespan, wedges);
  }

  const axisData = yearScale ? computeAxisData(yearScale.pxPerYear) : null;

  // The reference arcs draw *before* the wedge group below, so they sit
  // behind the wedges (a `<circle>`/`<path>` painted later covers one
  // painted earlier in SVG's own painter's-algorithm order) rather than
  // dashing across their fill -- the axis line/ticks/labels themselves stay
  // on top, drawn later, since those need to stay readable as an overlay.
  // A faint dashed reference arc at each tick's own radius, spanning the
  // whole circle -- so a wedge far from the x-axis can still be read against
  // the year scale, not just the two wedges the tick label itself sits
  // under. Same idea (and stroke-dasharray) as harrywind's own
  // `.refCircle`. Degenerate innerRadius=outerRadius arc -- a d3-shape
  // idiom for "just the curve", since arc() otherwise draws a filled
  // annular sector.
  if (axisData) {
    const refArc = d3arc<number>()
      .innerRadius((r) => r)
      .outerRadius((r) => r)
      .startAngle(-Math.PI)
      .endAngle(Math.PI);
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
  // texture. Moot in calendar-anchored mode below, where that same "missing
  // a date" person already gets the hatch treatment instead (nodeRadii has
  // nothing real to place them by either) -- still used in fixed mode, and
  // in calendar mode for the "Age at death" scheme's own reachable case
  // (both dates present, but birth >= death -- ageAtDeath's own guard).
  const NO_SCHEME_DATA = "#c9c2b3";

  // In calendar-anchored mode, a known person missing either date has no
  // real geometry to show either -- nodeRadii already fell back to the
  // same fixed placeholder radius an empty {} slot gets, so the fill
  // matches that same "unresearched" hatch rather than implying their
  // wedge boundary means something it doesn't. Fixed mode is unaffected:
  // its wedges never depend on dates in the first place.
  const fillFor = (d: Wedge): string => {
    if (!d.node?.person) return "url(#fan-hatch)";
    if (sizeByLifespan && !hasFullLifespan(d.node)) return "url(#fan-hatch)";
    if (colorScheme === "death") {
      const age = ageAtDeath(d.node);
      return age != null ? deathColorFor(age) : NO_SCHEME_DATA;
    }
    return genFill(d.depth);
  };
  const strokeBaseFor = (d: Wedge): string => {
    if (!d.node?.person) return "var(--mantine-color-default-border)";
    if (sizeByLifespan && !hasFullLifespan(d.node)) return "var(--mantine-color-default-border)";
    if (colorScheme === "death") {
      const age = ageAtDeath(d.node);
      return age != null ? darken(deathColorFor(age)) : darken(NO_SCHEME_DATA);
    }
    return genStroke(d.depth);
  };

  // A true annular sector (d3-arc) for every wedge in both modes -- the
  // reference port needs no taper: since every ancestor's own angular span
  // is a proper subset of its descendant's (collectWedges' own recursive
  // halving), painting ascending by depth below already keeps a descendant
  // visible everywhere its own ancestor's narrower slice doesn't cover it.
  // drawA0/drawA1 (collectWedges' own doc comment) are already the final
  // rendered bounds -- a growing inset on the parent-inherited edge only,
  // nothing on the sibling-shared edge -- so arcGen just draws them as-is.
  const arcGen = d3arc<Wedge>()
    .innerRadius((d) => d.innerR)
    .outerRadius((d) => Math.max(d.innerR + 1, d.outerR - 1))
    .startAngle((d) => d.drawA0)
    .endAngle((d) => d.drawA1)
    .cornerRadius(CORNER_RADIUS);

  // Root painted first/bottom, oldest ancestors last/top -- the reference's
  // own paint order (ascending ahnentafel number) for calendar-anchored
  // mode. SVG's own painter's-algorithm order is all "z-order" means here.
  // Only matters in calendar-anchored mode (fixed mode's rings never
  // overlap in the first place), but sorting unconditionally is harmless:
  // draw order doesn't affect anything else keyed off `wedges` itself
  // (axisData, deathAges, centerTarget lookups below all use the unsorted
  // array).
  const renderOrder = sizeByLifespan ? [...wedges].sort((a, b) => a.depth - b.depth) : wedges;

  const group = chartContent
    .append("g")
    .selectAll("g.wedge")
    .data(renderOrder)
    .join("g")
    .attr("class", "wedge")
    .style("cursor", (d) => (d.node?.person ? "pointer" : "default"))
    .on("click", (event, d) => {
      if (d.node?.person) {
        event.stopPropagation();
        onSelectPerson?.(d.node.person.handle);
      }
    })
    // Hover raises the wedge under the pointer to the very top of the
    // paint order (d3 selection.raise(), a same-parent "move to last
    // child" reorder -- cheap, no re-render) so a wedge buried under later-
    // painted ancestors is still fully visible on mouseover. group.order()
    // on mouseleave puts every wedge straight back into `renderOrder`'s own
    // sequence, undoing the raise() -- otherwise the ascending-by-depth
    // paint order this chart relies on for legible overlaps (nodeRadii's
    // own doc comment) would stay permanently scrambled by whichever wedge
    // was hovered last.
    .on("mouseenter", (event) => {
      select(event.currentTarget as Element).raise();
    })
    .on("mouseleave", () => {
      group.order();
    });

  group
    .append("path")
    .attr("d", (d) => arcGen(d))
    .attr("fill", (d) => fillFor(d))
    .attr("stroke", (d) => (d.node?.person?.handle === selectedHandle ? "var(--mantine-color-text)" : strokeBaseFor(d)))
    .attr("stroke-width", (d) => (d.node?.person?.handle === selectedHandle ? 2.5 : 1.5));

  const withPerson = group.filter((d) => !!d.node?.person);

  withPerson.append("title").text((d) => personTooltip(d.node!.person!));

  // Below this rendered arc width, even a single truncated character plus
  // clipString's own "…" reads as clutter rather than information -- skip
  // the on-wedge name/date text entirely rather than force a fit. The
  // native <title> tooltip above still covers every wedge regardless, so
  // hovering one still surfaces who it is. Root is always labeled (its own
  // labelWidth below uses radial thickness, not this angular measure, and
  // it's never anywhere near this small in practice).
  const MIN_LABEL_ARC_PX = 22;
  const hasRoomForLabel = (d: Wedge): boolean =>
    d.depth === 0 || (d.drawA1 - d.drawA0) * ((d.innerR + d.outerR) / 2) >= MIN_LABEL_ARC_PX;

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
  const labelGroup = withPerson.filter(hasRoomForLabel).append("g").attr("transform", (d) => {
    if (d.depth === 0) return `translate(0,${-(d.innerR + d.outerR) / 2})`;
    const thetaDeg = (((d.drawA0 + d.drawA1) / 2) * 180) / Math.PI;
    const midR = (d.innerR + d.outerR) / 2;
    return `rotate(${thetaDeg - 90}) translate(${midR},0) rotate(90)`;
  });

  const labelWidth = (d: Wedge): number =>
    d.depth === 0
      ? (d.outerR - d.innerR) * 1.6
      : Math.max(30, (d.drawA1 - d.drawA0) * ((d.innerR + d.outerR) / 2) - 8);

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
  // bottom of the panel), centered on *today* (currentYear), using the
  // exact same derived pxPerYear scale (computeYearScale) nodeRadii already
  // draws wedges with. This is a precise calendar axis, not a rough
  // approximation: every wedge's
  // own inner/outer edge is that specific person's own death/birth year
  // radius, so reading a wedge's boundary against this axis gives back
  // their real dates. The reference arcs at these same tick radii were
  // already drawn *before* the wedges, above (axisData's own doc comment).
  // Lives in `chartContent` like everything else here, so it pans and
  // scales with the wedges rather than staying pinned to the viewport.
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

  // Root sits at the panel's own visual center -- both offsets are a plain
  // half-dimension, unlike a half-dome layout's own above-the-bottom-edge
  // anchor, since the circle grows in every direction rather than only
  // upward.
  const xOffset = -bboxWidth / 2;
  const yOffset = -bboxHeight / 2;
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
  //     root click animates to the same whole-circle fit computeFitTransform
  //     gives the initial-draw case, the fan chart's equivalent of a
  //     "reset view" / breadcrumb-home click.
  //  2. No `initialZoom` at all -- FanChart.tsx only omits it on a fresh
  //     root, once the tree's just grown deeper (treeMaxDepth), or a "Size
  //     by lifespan" flip, so this is "fit the whole circle to the window."
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
      // content-space (0,0) *is* the panel's own visual center (xOffset/
      // yOffset above are a plain half-dimension each), so there's no extra
      // offset to translate by before centering on (cx,cy).
      centered = zoomIdentity.scale(scale).translate(-cx, -cy);
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
