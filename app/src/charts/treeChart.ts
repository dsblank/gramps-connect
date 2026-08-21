// Port of gramps-web's ../../../gramps-web/src/charts/TreeChart.js
// (TreeChartCore/TreeChart) -- d3-hierarchy for layout, d3-shape for the
// connecting links, d3-zoom for pan/zoom, raw d3-selection to build the SVG,
// the same "imperative lib in a ref" shape components/visuals/MapCanvas.tsx
// already uses for maplibre-gl. Deliberately smaller than the source: no
// hover-preview popover. It does draw its own boundary marker (see
// `hasMore` below) on any box at the edge of the loaded tree with further
// known ancestors/descendants -- both an IntersectionObserver target for
// components/visuals/TreeChart.tsx's own reveal observer (auto-expand) and
// a click target (`onExpand`, manual expand -- the always-available
// fallback for whenever auto-expand doesn't fire, or the user has turned it
// off via store/treeExpandPreference.ts). Most colors are literal
// `var(--mantine-...)`
// strings passed straight into `.attr()` -- SVG presentation attributes
// resolve CSS custom properties the same way gramps-web's own
// `var(--grampsjs-body-font-color-70)` usage does, so light/dark just works
// with no re-render needed on theme toggle. The gender accent is the
// exception: it's a *validated* categorical pair (see GENDER_FILL below),
// not a Mantine token, so it's computed per mode in JS the way
// eventCategories.ts's own dotStyle()/FILL are -- that needs a `dark` flag
// threaded in from the caller and a re-render on toggle.
import { max, min } from "d3-array";
import { hierarchy, tree as d3tree, type HierarchyPointNode } from "d3-hierarchy";
import { create, type Selection } from "d3-selection";
import { curveBumpX, link } from "d3-shape";
import { zoom, type ZoomTransform } from "d3-zoom";
import { personThumbnailUrl, type TreeNode } from "../store/treeData";

const BOX_WIDTH = 190;
const BOX_HEIGHT = 90;
const PADDING = 20;
const GAP_X = 60;
// gramps-web's own default (charts/TreeChart.js) -- the vertical gap
// between sibling boxes in the same generation/column, which is what
// nodeSize's x-step below controls. Was 8; the extra 3px per row adds up
// across a full generation of leaf slots and was visibly looser than
// gramps-web's own chart at the same depth.
const GAP_Y = 5;
const TEXT_PADDING = 12;
const IMG_PADDING = 10;
const IMG_SIZE = BOX_HEIGHT - IMG_PADDING * 2;
/** A rounded-*rect* crop, not gramps-web's circle -- same call
 * MediaThumbnail.tsx's own doc comment already made and documented ("tried
 * a circular crop first, but a scanned document or a landscape/group photo
 * doesn't survive being cropped to a circle the way a portrait does").
 * Smaller than the box's own 8px corner so the thumbnail still reads as
 * nested inside it. */
const IMG_CORNER = 6;
/** Bitmap fetch size -- oversized relative to the ~70px display footprint
 * (IMG_SIZE) the way gramps-web's own `getImageUrl(person, 100)` is, so it
 * stays crisp on a high-DPI screen or once zoomed in. */
const IMG_FETCH_SIZE = 100;

/** Slots 1 (blue) and 5 (magenta) of the validated categorical palette
 * (dataviz skill's references/palette.md), not slots 1+2 in fixed order --
 * blue/pink for male/female is a domain convention as strong as gramps-web's
 * own genderColor (and this screenshot's own reference), and the pair
 * passes every check `node scripts/validate_palette.js "#2a78d6,#e87ba4"
 * --mode light --pairs all` (and the dark equivalent) other than light
 * mode's contrast floor (magenta 2.62:1, WARN-band) -- relief for that is
 * the gender word folded into each box's <title> tooltip below, since nothing
 * here depends on the accent bar alone to say who's who. Unknown/other
 * (Gramps gender 2/3) get no accent at all, the same call
 * eventCategories.ts makes for its own "Other" category: a chromatic-enough
 * grey collides under CVD sim, and a bar with no identity to encode
 * shouldn't invent a third color to hold that place. */
const GENDER_FILL: Record<0 | 1, { light: string; dark: string }> = {
  0: { light: "#e87ba4", dark: "#d55181" },
  1: { light: "#2a78d6", dark: "#3987e5" },
};
const GENDER_LABEL: Record<number, string> = { 0: "female", 1: "male", 2: "unknown gender", 3: "other gender" };

function genderAccent(gender: number | undefined, dark: boolean): string | null {
  if (gender !== 0 && gender !== 1) return null;
  return GENDER_FILL[gender][dark ? "dark" : "light"];
}

/** Depth of the built tree, over *every* child (not just the first two the
 * way gramps-web's own countDepthOfTree does -- harmless for the ancestor
 * side, which never has more than two children, but an undercount waiting
 * to happen on the descendant side, which can have any number). */
function countDepthOfTree(node: TreeNode | undefined): number {
  if (!node) return 0;
  const kids = node.children ?? [];
  if (kids.length === 0) return 1;
  return 1 + Math.max(...kids.map(countDepthOfTree));
}

function clipString(s: string, widthPx: number): string {
  if (!s) return "";
  const fontSize = 13;
  const nChar = Math.floor(widthPx / (fontSize * 0.6));
  if (s.length <= nChar) return s;
  if (nChar < 2) return "";
  return `${s.slice(0, nChar - 2)}…`;
}

interface CoreOptions {
  /** A click *selects* -- see renderTreeChart's own doc comment on why this
   * doesn't navigate directly. */
  onSelectPerson?: (handle: string) => void;
  selectedHandle?: string | null;
  dark: boolean;
  /** For building thumbnail URLs (personThumbnailUrl's `jwt` query param) --
   * null before the token's first resolved, in which case no box gets a
   * thumbnail rather than a broken image. */
  token: string | null;
  /** `${direction}:${handle}` keys currently being fetched by TreeView's own
   * per-node lazy-expand -- swaps a boundary marker's "+" for a dimmed "…"
   * rather than this module owning any fetch/loading state itself. */
  expandingKeys?: Set<string>;
  /** Clicking a boundary marker always expands it, regardless of the
   * manual-expand-only preference (treeExpandPreference.ts) -- that
   * preference only gates whether TreeChart.tsx's own reveal observer also
   * fires this automatically. Same signature as the observer's own trigger,
   * see TreeChart.tsx's doc comment on why. */
  onExpand?: (label: string, handle: string, direction: "ancestor" | "descendant") => void;
}

/** Lays out and draws one generation-tree (ancestors or descendants) into
 * `svgParent`, returning [xOffset, yOffset, width, height, rootX] --
 * gramps-web's TreeChartCore's four plus its constant 5th "overlap" return
 * value (`boxWidth + 2*padding`, inlined at the call site below instead) --
 * with the root's own vertical position appended, for renderTreeChart to
 * frame the initial view on rather than the tree's whole bounding box (see
 * its own doc comment on why). */
function treeChartCore(
  svgParent: Selection<SVGGElement, undefined, null, undefined>,
  data: TreeNode,
  orientation: "LTR" | "RTL",
  { onSelectPerson, selectedHandle, dark, token, expandingKeys, onExpand }: CoreOptions,
): [number, number, number, number, number] {
  const root: HierarchyPointNode<TreeNode> = d3tree<TreeNode>()
    .nodeSize([BOX_HEIGHT + GAP_Y, BOX_WIDTH + GAP_X])
    .separation(() => 1)(hierarchy(data, (d) => d.children));

  const descendants = root.descendants();
  const trueDepth = countDepthOfTree(data);
  // d3-hierarchy's .descendants() is a pre-order traversal, so the root is
  // always first -- and its own x (this function never translates the x/
  // vertical axis, only y/depth) is untouched by every translate applied
  // below or by renderTreeChart, so this is the root's *final* composite
  // vertical position too.
  const rootX = root.x;

  if (orientation === "RTL") {
    for (const d of descendants) d.y = -d.y;
  }

  const width = trueDepth * BOX_WIDTH + (trueDepth - 1) * GAP_X + 2 * PADDING;
  const xs = descendants.map((d) => d.x);
  const minX = min(xs) ?? 0;
  const maxX = max(xs) ?? 0;
  const height = maxX - minX + BOX_HEIGHT;
  const yOffset = minX - BOX_HEIGHT / 2;
  const xOffset = orientation === "RTL" ? BOX_WIDTH / 2 + PADDING - width : -BOX_WIDTH / 2 - PADDING;

  const chart = svgParent.append("g").attr("transform", `translate(${-xOffset},0)`);

  chart
    .append("g")
    .attr("fill", "none")
    .attr("stroke", "var(--mantine-color-default-border)")
    .attr("stroke-opacity", 0.7)
    .attr("stroke-width", 1)
    .selectAll("path")
    .data(root.links())
    .join("path")
    .attr("d", (d) => {
      const sourceX = d.source.x;
      const sourceY = orientation === "LTR" ? d.source.y + BOX_WIDTH / 2 - 10 : d.source.y - BOX_WIDTH / 2 + 10;
      const targetX = d.target.x;
      const targetY = orientation === "LTR" ? d.target.y - BOX_WIDTH / 2 + 10 : d.target.y + BOX_WIDTH / 2 - 10;
      // Tuple points ([y, x], the default d3-shape link() expects) rather
      // than custom .x()/.y() accessors -- d3 draws in (y, x) here because
      // the tree grows left-to-right/right-to-left but nodeSize laid it out
      // top-to-bottom/bottom-to-top.
      return link(curveBumpX)({
        source: [sourceY, sourceX],
        target: [targetY, targetX],
      });
    });

  const node = chart
    .append("g")
    .selectAll("g")
    .data(descendants)
    .join("g")
    .attr("transform", (d) => `translate(${d.y},${d.x})`)
    .style("filter", (d) => (d.depth === 0 ? "drop-shadow(0 3px 8px rgba(0,0,0,.3))" : null))
    .style("cursor", (d) => (d.data.person ? "pointer" : "default"))
    .on("click", (_event, d) => {
      if (d.data.person) onSelectPerson?.(d.data.person.handle);
    });

  const withPerson = node.filter((d) => !!d.data.person);

  // The gender accent: a rounded pill sitting mostly *behind* the main box
  // (appended first, and positioned 4px further left, per gramps-web's own
  // TreeChart.js), so only a rounded sliver shows along the box's left
  // edge once the box rect is drawn on top of it -- ported verbatim rather
  // than reinvented, since it's already the exact look this feature is
  // matching.
  withPerson
    .filter((d) => genderAccent(d.data.person?.gender, dark) !== null)
    .append("rect")
    .attr("width", 24)
    .attr("height", BOX_HEIGHT - 1)
    .attr("rx", 12)
    .attr("ry", 12)
    .attr("transform", `translate(${-BOX_WIDTH / 2 - 4},${-BOX_HEIGHT / 2 + 0.5})`)
    .attr("fill", (d) => genderAccent(d.data.person!.gender, dark)!);

  withPerson
    .append("rect")
    .attr("width", BOX_WIDTH)
    .attr("height", BOX_HEIGHT)
    .attr("rx", 8)
    .attr("ry", 8)
    .attr("transform", `translate(${-BOX_WIDTH / 2},${-BOX_HEIGHT / 2})`)
    .attr("fill", "var(--mantine-color-body)")
    // The selected box keeps its size but takes a thicker ring in ink
    // instead of the default border -- same treatment MapCanvas gives its
    // selected marker, for the same reason: the detail card outlives the
    // pointer that opened it.
    .attr("stroke", (d) => (d.data.person?.handle === selectedHandle ? "var(--mantine-color-text)" : "var(--mantine-color-default-border)"))
    .attr("stroke-width", (d) => (d.data.person?.handle === selectedHandle ? 2 : 1));

  withPerson
    .append("title")
    .text((d) => {
      const name = [d.data.nameGiven, d.data.nameSurname].filter(Boolean).join(" ") || "(unknown)";
      const gender = GENDER_LABEL[d.data.person!.gender];
      return gender ? `${name} (${gender})` : name;
    });

  // Thumbnail: a plain <image> (preserveAspectRatio "slice", the SVG
  // equivalent of CSS object-fit: cover) clipped to a rounded rect via a
  // per-node <clipPath> -- not gramps-web's circle, see IMG_CORNER's own
  // doc comment. IDs are namespaced per orientation: the ancestor and
  // descendant trees are two separate hierarchies that both start their
  // own node-id sequence at "p" (the shared root), so an unprefixed id
  // would collide between them in this one shared <svg> document.
  const thumbnailUrl = (d: HierarchyPointNode<TreeNode>): string | null =>
    token && d.data.person ? personThumbnailUrl(token, d.data.person, IMG_FETCH_SIZE) : null;
  const withImage = withPerson.filter((d) => !!thumbnailUrl(d));
  const imgX = -BOX_WIDTH / 2 + IMG_PADDING;
  const imgY = -BOX_HEIGHT / 2 + IMG_PADDING;

  const defs = svgParent.append("defs");
  defs
    .selectAll(".imgclip")
    .data(withImage.data())
    .enter()
    .append("clipPath")
    .attr("id", (d) => `imgclip-${orientation}-${d.data.id}`)
    .append("rect")
    .attr("x", imgX)
    .attr("y", imgY)
    .attr("width", IMG_SIZE)
    .attr("height", IMG_SIZE)
    .attr("rx", IMG_CORNER)
    .attr("ry", IMG_CORNER);

  withImage
    .append("image")
    .attr("x", imgX)
    .attr("y", imgY)
    .attr("width", IMG_SIZE)
    .attr("height", IMG_SIZE)
    .attr("preserveAspectRatio", "xMidYMid slice")
    .attr("clip-path", (d) => `url(#imgclip-${orientation}-${d.data.id})`)
    .attr("xlink:href", (d) => thumbnailUrl(d)!);

  // Text starts further right of a box that has a thumbnail, to clear it --
  // per-node, since only some boxes in a tree have one.
  const textPadding = (d: HierarchyPointNode<TreeNode>) =>
    thumbnailUrl(d) ? IMG_SIZE + 2 * IMG_PADDING : 2 * TEXT_PADDING;
  const textWidth = (d: HierarchyPointNode<TreeNode>) =>
    thumbnailUrl(d) ? BOX_WIDTH - 2 * IMG_PADDING - IMG_SIZE : BOX_WIDTH - 2 * TEXT_PADDING;
  const textX = (d: HierarchyPointNode<TreeNode>) => -BOX_WIDTH / 2 + textPadding(d);

  const withName = node.filter((d) => !!(d.data.nameGiven || d.data.nameSurname));

  withName
    .append("text")
    .attr("y", -BOX_HEIGHT / 2 + 25)
    .attr("x", textX)
    .attr("text-anchor", "start")
    .attr("font-weight", 600)
    .attr("fill", "var(--mantine-color-text)")
    .text((d) => clipString(d.data.nameSurname ? `${d.data.nameSurname},` : "…", textWidth(d)));

  withName
    .append("text")
    .attr("y", -BOX_HEIGHT / 2 + 42)
    .attr("x", textX)
    .attr("text-anchor", "start")
    .attr("font-weight", 500)
    .attr("fill", "var(--mantine-color-text)")
    .text((d) => clipString(d.data.nameGiven || "…", textWidth(d)));

  node
    .filter((d) => !!d.data.person?.profile?.birth?.date)
    .append("text")
    .attr("y", -BOX_HEIGHT / 2 + 59)
    .attr("x", textX)
    .attr("text-anchor", "start")
    .attr("fill", "var(--mantine-color-dimmed)")
    .text((d) => clipString(`*${d.data.person?.profile?.birth?.date}`, textWidth(d)));

  node
    .filter((d) => !!d.data.person?.profile?.death?.date)
    .append("text")
    .attr("y", -BOX_HEIGHT / 2 + 76)
    .attr("x", textX)
    .attr("text-anchor", "start")
    .attr("fill", "var(--mantine-color-dimmed)")
    .text((d) => clipString(`†${d.data.person?.profile?.death?.date}`, textWidth(d)));

  // Boundary marker: an IntersectionObserver target *and* a click target on
  // any box at the edge of the loaded tree with further known ancestors/
  // descendants (TreeNode.hasMore, set by treeData.ts's own recursion
  // cutoff). The click always works, regardless of the manual-expand-only
  // preference -- that preference only gates whether TreeChart.tsx's own
  // reveal observer *also* fires this automatically, since auto-expand
  // doesn't always fire (see that file's own doc comment) and this is the
  // fallback either way. Direction follows orientation the same way every
  // other half-specific choice here does (LTR draws ancestors, RTL
  // descendants).
  const direction: "ancestor" | "descendant" = orientation === "LTR" ? "ancestor" : "descendant";
  // The edge facing away from the root, in the same local box coordinate
  // space (-BOX_WIDTH/2..BOX_WIDTH/2) every other box part above draws in --
  // only the container-level transform differs between the two halves.
  const outwardX = orientation === "LTR" ? BOX_WIDTH / 2 : -BOX_WIDTH / 2;
  const HIT_WIDTH = 60;
  const MARKER_R = 9;
  // Local coordinates here start exactly at the box's own edge (`marker`'s
  // own translate below), so a dot centered at 0 would draw half *on top of*
  // the box -- clicking that half used to hit the box's own click-to-select
  // instead of this marker, because the invisible hit-rect (which starts at
  // the edge, not before it) never covered that overlapping half in the
  // first place. Centering the visible dot a few px clear of the edge
  // instead keeps the whole glyph inside the hit-rect and off the box.
  const outward = (n: number) => (orientation === "LTR" ? n : -n);
  const markerCenter = outward(4 + MARKER_R);

  const withMarker = withPerson.filter((d) => !!d.data.hasMore);

  const marker = withMarker
    .append("g")
    .attr("transform", `translate(${outwardX},0)`);

  // The IntersectionObserver target *and* the click target: sized to scale
  // with overall zoom the same way the box itself does (TreeChart.tsx's own
  // MIN_AUTOEXPAND_MARKER_PX throttle relies on that) and much bigger than
  // the visible dot so it's an easy click target too, not just a precise
  // one. `stopPropagation` keeps a click here from also firing the parent
  // node `<g>`'s own click-to-select handler it sits inside of.
  marker
    .append("rect")
    .attr("data-tree-expand", "true")
    .attr("data-handle", (d) => d.data.person!.handle)
    .attr("data-direction", direction)
    .attr("data-label", (d) => d.data.id!)
    .attr("x", orientation === "LTR" ? 0 : -HIT_WIDTH)
    .attr("y", -BOX_HEIGHT / 2)
    .attr("width", HIT_WIDTH)
    .attr("height", BOX_HEIGHT)
    .attr("fill", "transparent")
    .style("cursor", "pointer")
    .on("click", (event, d) => {
      event.stopPropagation();
      if (d.data.person) onExpand?.(d.data.id!, d.data.person.handle, direction);
    });

  // Purely decorative -- a small dot most of the time, a dimmed "…" while
  // TreeView's own per-node lazy-expand has this handle's next generation
  // in flight, so the user has some sense of *why* a box they're panning
  // toward just grew children (or what a click here is about to do).
  // `pointer-events: none` so only the hit-rect above handles the click.
  marker
    .append("circle")
    .attr("cx", markerCenter)
    .attr("r", MARKER_R)
    .attr("fill", (d) =>
      expandingKeys?.has(`${direction}:${d.data.person!.handle}`)
        ? "var(--mantine-color-dimmed)"
        : "var(--mantine-primary-color-filled)",
    )
    .attr("stroke", "var(--mantine-color-body)")
    .attr("stroke-width", 2)
    .style("pointer-events", "none");

  marker
    .append("text")
    .attr("x", markerCenter)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("fill", "white")
    .attr("font-size", 13)
    .attr("font-weight", 700)
    .style("pointer-events", "none")
    .text((d) => (expandingKeys?.has(`${direction}:${d.data.person!.handle}`) ? "…" : "+"));

  return [xOffset, yOffset, width, height, rootX];
}

export interface TreeChartOptions {
  bboxWidth: number;
  bboxHeight: number;
  /** Read off the previous render's SVG (d3-zoom's `zoomTransform`) and
   * handed back in, so panning/zooming survives a data or size change
   * instead of resetting to identity each time -- same idea as gramps-web's
   * Lit `willUpdate`/`updated` save-restore, done here by the caller
   * (components/visuals/TreeChart.tsx) around each render call. */
  initialZoom?: ZoomTransform | null;
  /** A click *selects* a person -- into the caller's own detail card, the
   * same positional rule Map/Timeline follow (clicking in the plot
   * previews, clicking in the preview commits) -- rather than navigating
   * away itself. That decision belongs to components/visuals/TreeView.tsx,
   * not this module: it's the one that knows what "open" means (the People
   * view) and owns the card. */
  onSelectPerson?: (handle: string) => void;
  /** Rings the matching box the way MapCanvas rings its selected marker, so
   * the record the detail card is describing stays findable once the
   * pointer has moved away. */
  selectedHandle?: string | null;
  dark: boolean;
  token: string | null;
  /** See CoreOptions' own doc comment -- threaded straight through. */
  expandingKeys?: Set<string>;
  /** See CoreOptions' own doc comment -- threaded straight through. */
  onExpand?: (label: string, handle: string, direction: "ancestor" | "descendant") => void;
}

/** Draws both halves (descendants on the left, RTL, ancestors on the right,
 * LTR, sharing one root) into a fresh SVG element sized to
 * bboxWidth/bboxHeight, and returns it -- the caller owns inserting and
 * removing it from the DOM. */
export function renderTreeChart(
  ancestorTree: TreeNode | null,
  descendantTree: TreeNode | null,
  { bboxWidth, bboxHeight, initialZoom, onSelectPerson, selectedHandle, dark, token, expandingKeys, onExpand }: TreeChartOptions,
): SVGSVGElement {
  const svg = create("svg").attr("font-family", "var(--mantine-font-family)").attr("font-size", 13);
  const chartContent = svg.append("g").attr("id", "tree-chart-content");

  svg.call(
    zoom<SVGSVGElement, undefined>().on("zoom", (e) => {
      chartContent.attr("transform", e.transform.toString());
    })
  );
  if (initialZoom) {
    (svg.node() as unknown as { __zoom: ZoomTransform }).__zoom = initialZoom;
    chartContent.attr("transform", initialZoom.toString());
  }

  // The two halves are butted together at their shared root: the overlap is
  // exactly one root box (boxWidth + 2*padding), gramps-web's TreeChartCore
  // returns that as a constant 5th value -- inlined here instead.
  const overlap = BOX_WIDTH + 2 * PADDING;
  // Framed on the root's own position, not the combined content's bounding
  // box (which is what gramps-web itself does, and what this port did
  // originally): a handful of ancestor generations is routinely taller than
  // the viewport, and centering the whole bounding box left the root --
  // the one thing the user opened this view to see -- outside the initial
  // frame, at the bounding box's midpoint instead. The horizontal anchor is
  // a constant: both halves are built so their root boxes coincide exactly
  // at BOX_WIDTH/2 + PADDING in the composite SVG. The vertical one can
  // differ slightly between the two halves (the ancestor side is always a
  // complete, symmetric binary tree via its empty-slot padding; the
  // descendant side, real children only, usually isn't) -- averaged when
  // both are present.
  let rootXSum = 0;
  let rootXCount = 0;
  const coreOptions: CoreOptions = { onSelectPerson, selectedHandle, dark, token, expandingKeys, onExpand };

  if (descendantTree) {
    const chartD = chartContent.append("g");
    const [, , widthD, , rootXD] = treeChartCore(chartD, descendantTree, "RTL", coreOptions);
    chartD.attr("transform", `translate(${-widthD + overlap},0)`);
    rootXSum += rootXD;
    rootXCount += 1;
  }
  if (ancestorTree) {
    const chartA = chartContent.append("g");
    const [, , , , rootXA] = treeChartCore(chartA, ancestorTree, "LTR", coreOptions);
    chartA.attr("transform", "translate(0,0)");
    rootXSum += rootXA;
    rootXCount += 1;
  }
  const rootVertical = rootXCount > 0 ? rootXSum / rootXCount : 0;
  const rootHorizontal = BOX_WIDTH / 2 + PADDING;

  const xOffset = rootHorizontal - bboxWidth / 2;
  const yOffset = rootVertical - bboxHeight / 2;

  svg.attr("viewBox", `${xOffset} ${yOffset} ${bboxWidth} ${bboxHeight}`);
  svg.attr("width", bboxWidth).attr("height", bboxHeight);
  return svg.node()!;
}
