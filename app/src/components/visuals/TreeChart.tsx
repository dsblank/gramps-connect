import { useEffect, useRef, useState } from "react";
import { useComputedColorScheme } from "@mantine/core";
import { zoomTransform, type ZoomTransform } from "d3-zoom";
import { renderTreeChart } from "../../charts/treeChart";
import type { TreeNode } from "../../store/treeData";

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
}

/** Owns a plain `div` and hands its DOM to the d3 renderer -- same
 * "imperative lib in a ref" shape as MapCanvas.tsx wraps maplibre-gl in,
 * sized off its own ResizeObserver the way TimelineChart.tsx measures its
 * canvas. Re-renders on a color-scheme flip (unlike most of this chart's
 * colors, which are raw `var(--mantine-...)` and swap live with no
 * re-render) because the gender accent is a validated hex pair, not a
 * Mantine token -- same reason MapCanvas itself re-renders its markers on
 * `dark` (see its own `seriesColor(dark)`). */
export function TreeChart({ ancestorTree, descendantTree, selectedHandle, onSelectPerson, token }: TreeChartProps) {
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
    });
    container.replaceChildren(svg);
  }, [ancestorTree, descendantTree, size.width, size.height, selectedHandle, onSelectPerson, dark, token]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
