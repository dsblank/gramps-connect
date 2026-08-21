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
  /** Fired for a boundary marker (a box with `TreeNode.hasMore`, drawn by
   * charts/treeChart.ts) -- either clicked directly (charts/treeChart.ts's
   * own handler, always live) or, when `autoExpandEnabled`, revealed by a
   * pan/zoom/scroll (this component's own IntersectionObserver below).
   * `label` is the node's own branch id (TreeNode.id, e.g. "pfm"). Already
   * idempotent on TreeView's side, so this component doesn't need to guard
   * against re-firing for the same element. */
  onExpand: (label: string, handle: string, direction: "ancestor" | "descendant") => void;
  /** `${direction}:${handle}` keys currently in flight, mirrored from
   * TreeView's own guard -- shows a small loading state on that marker
   * instead of one a reveal/click would just re-trigger. */
  expandingKeys: Set<string>;
  /** The manual-expand-only preference (store/treeExpandPreference.ts),
   * inverted: false skips creating the reveal observer below entirely,
   * leaving each marker's own click (always wired, see charts/treeChart.ts)
   * as the only way to expand -- e.g. for whenever auto-expand doesn't fire
   * (a backgrounded/occluded tab throttles IntersectionObserver entirely,
   * see this file's own doc comment) or is simply unwanted. */
  autoExpandEnabled: boolean;
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
  ancestorTree, descendantTree, selectedHandle, onSelectPerson, token, onExpand, expandingKeys, autoExpandEnabled,
}: TreeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const zoomRef = useRef<ZoomTransform | null>(null);
  // The previous render's selection, so a *new* selection (someone just
  // clicked a different person) can be told apart from `selectedHandle`
  // simply being unchanged across an unrelated rebuild (an expand, a
  // resize, a theme flip) -- only the former should re-center the view.
  const prevSelectedHandleRef = useRef<string | null>(null);
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

    const justSelected = selectedHandle !== null && selectedHandle !== prevSelectedHandleRef.current;
    prevSelectedHandleRef.current = selectedHandle;

    const svg = renderTreeChart(ancestorTree, descendantTree, {
      bboxWidth: size.width,
      bboxHeight: size.height,
      initialZoom: zoomRef.current,
      selectedHandle,
      onSelectPerson,
      dark,
      token,
      expandingKeys,
      onExpand,
      centerOnSelect: justSelected,
    });
    container.replaceChildren(svg);

    // Auto-expand-on-reveal: watches every boundary marker
    // (charts/treeChart.ts's own `[data-tree-expand]` elements) in the fresh
    // SVG and fires `onExpand` once it's actually been panned/zoomed/
    // scrolled into view. Skipped entirely when the user has opted into
    // manual-only expansion (store/treeExpandPreference.ts) -- each
    // marker's own click (wired unconditionally in charts/treeChart.ts) is
    // always the fallback either way, notably for whenever this observer
    // doesn't fire at all: a backgrounded/occluded browser tab throttles
    // IntersectionObserver (and requestAnimationFrame) completely, which is
    // exactly the "sometimes a block doesn't expand" case this preference
    // and the click affordance both exist for. Re-created every render
    // since replaceChildren above just discarded the previous SVG -- and
    // anything observing its elements -- wholesale. Rooted at this
    // component's own container div (not the default viewport root) so
    // "visible" means "within this chart panel", not "anywhere on the
    // page".
    if (!autoExpandEnabled) return;
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
  }, [
    ancestorTree, descendantTree, size.width, size.height, selectedHandle, onSelectPerson, dark, token, onExpand,
    expandingKeys, autoExpandEnabled,
  ]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
