import { useEffect, useRef, useState } from "react";
import { useComputedColorScheme } from "@mantine/core";
import { zoomTransform, type ZoomTransform } from "d3-zoom";
import { renderTreeChart } from "../../charts/treeChart";
import type { TreeNode } from "../../store/treeData";

/** Auto-expand-on-reveal won't fire until a boundary marker has been
 * on-screen at at least this many CSS pixels wide -- the marker's hit-rect
 * (charts/treeChart.ts) is sized to scale with overall zoom the same way a
 * person box does, so this doubles as a "only once the tree is legible, not
 * a barely-visible speck zoomed way out" throttle: it keeps a wide zoomed-out
 * view with dozens of simultaneously-visible boundary nodes from firing a
 * fetch burst all at once. */
const MIN_AUTOEXPAND_MARKER_PX = 40;

interface TreeChartProps {
  ancestorTree: TreeNode | null;
  descendantTree: TreeNode | null;
  /** The box to ring as selected -- TreeView's own state, so it stays in
   * sync with whichever card (if any) is showing. */
  selectedHandle: string | null;
  /** A click *selects* -- it doesn't navigate. See TreeView's own doc
   * comment on why: the same positional rule Map/Timeline follow. */
  onSelectPerson: (handle: string) => void;
  /** For thumbnail URLs (personThumbnailUrl's `jwt` query param) -- null
   * until TreeView's own fetch has resolved one. */
  token: string | null;
  /** Fired when a boundary marker (a box with `TreeNode.hasMore`, drawn by
   * charts/treeChart.ts) is panned/zoomed/scrolled into view -- the only
   * trigger for per-node lazy-expand, there's no click affordance. `label`
   * is the node's own branch id (TreeNode.id, e.g. "pfm"). Already
   * idempotent on TreeView's side, so this component doesn't need to guard
   * against re-firing for the same element. */
  onExpand: (label: string, handle: string, direction: "ancestor" | "descendant") => void;
  /** `${direction}:${handle}` keys currently in flight, mirrored from
   * TreeView's own guard -- shows a small loading state on that marker
   * instead of one a reveal would just re-trigger. */
  expandingKeys: Set<string>;
}

/** Owns a plain `div` and hands its DOM to the d3 renderer -- same
 * "imperative lib in a ref" shape as MapCanvas.tsx wraps maplibre-gl in,
 * sized off its own ResizeObserver the way TimelineChart.tsx measures its
 * canvas. Re-renders on a color-scheme flip (unlike most of this chart's
 * colors, which are raw `var(--mantine-...)` and swap live with no
 * re-render) because the gender accent is a validated hex pair, not a
 * Mantine token -- same reason MapCanvas itself re-renders its markers on
 * `dark` (see its own `seriesColor(dark)`). */
export function TreeChart({
  ancestorTree, descendantTree, selectedHandle, onSelectPerson, token, onExpand, expandingKeys,
}: TreeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const zoomRef = useRef<ZoomTransform | null>(null);
  const dark = useComputedColorScheme("light") === "dark";

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || size.width <= 0 || size.height <= 0) return;
    // Capture the outgoing SVG's zoom transform before replacing it, so
    // panning/zooming survives a data change (a generation-count edit) or a
    // resize instead of resetting to identity each render.
    const existing = container.querySelector("svg");
    if (existing) zoomRef.current = zoomTransform(existing);

    const svg = renderTreeChart(ancestorTree, descendantTree, {
      bboxWidth: size.width,
      bboxHeight: size.height,
      initialZoom: zoomRef.current,
      selectedHandle,
      onSelectPerson,
      dark,
      token,
      expandingKeys,
    });
    container.replaceChildren(svg);

    // Auto-expand-on-reveal: watches every boundary marker
    // (charts/treeChart.ts's own `[data-tree-expand]` elements) in the fresh
    // SVG and fires `onExpand` once it's actually been panned/zoomed/
    // scrolled into view. Re-created every render since replaceChildren
    // above just discarded the previous SVG -- and anything observing its
    // elements -- wholesale. Rooted at this component's own container div
    // (not the default viewport root) so "visible" means "within this chart
    // panel", not "anywhere on the page".
    let skippedInitialBatch = false;
    const io = new IntersectionObserver(
      (entries) => {
        // The observer's first callback batch reports each element's
        // already-current state as of `observe()` -- i.e. it fires with no
        // pan/zoom/scroll at all, which would auto-expand right on this
        // render (including the render an expand's own rebuild just
        // caused). Skipping it is what makes this "on reveal", not "on
        // paint" -- explicitly what was asked for.
        if (!skippedInitialBatch) {
          skippedInitialBatch = true;
          return;
        }
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (entry.boundingClientRect.width < MIN_AUTOEXPAND_MARKER_PX) continue;
          const el = entry.target as SVGRectElement;
          const { handle, direction, label } = el.dataset;
          if (!handle || !direction || !label) continue;
          onExpand(label, handle, direction as "ancestor" | "descendant");
        }
      },
      { root: container, threshold: 0.4 },
    );
    svg.querySelectorAll<SVGRectElement>("[data-tree-expand]").forEach((el) => io.observe(el));

    return () => io.disconnect();
  }, [ancestorTree, descendantTree, size.width, size.height, selectedHandle, onSelectPerson, dark, token, onExpand, expandingKeys]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
