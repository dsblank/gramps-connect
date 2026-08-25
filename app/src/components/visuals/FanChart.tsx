import { useEffect, useRef, useState } from "react";
import { zoomTransform, type ZoomTransform } from "d3-zoom";
import { renderFanChart, treeMaxDepth, type FanColorScheme } from "../../charts/fanChart";
import type { TreeNode } from "../../store/treeData";

interface FanChartProps {
  ancestorTree: TreeNode | null;
  selectedHandle: string | null;
  /** A click *selects* -- see TreeChart.tsx's own doc comment on why. */
  onSelectPerson: (handle: string) => void;
  /** TreeView.tsx's own "Show lifespan" checkbox -- threaded straight
   * through to fanChart.ts's own collectWedges. */
  sizeByLifespan: boolean;
  /** TreeView.tsx's own "Generation"/"Age at death" SegmentedControl. */
  colorScheme: FanColorScheme;
}

/** Owns a plain `div` and hands its DOM to the d3 renderer -- same
 * "imperative lib in a ref" shape as TreeChart.tsx wraps treeChart.ts in.
 * Sized off its own ResizeObserver. Unlike TreeChart.tsx's own gender
 * accent, GEN_COLORS/DEATH_COLORS (fanChart.ts) are the same hex in light
 * and dark mode -- ported verbatim from harrywind.nl, which has no dark
 * mode of its own to diverge from -- so there's no color-scheme flip to
 * re-render on here.
 *
 * Owns two pieces of "did something just happen" state, mirroring
 * TreeChart.tsx's own prevSelectedHandleRef pattern:
 *  - a fresh root, a deeper tree (treeMaxDepth grew, via "Increase depth"),
 *    or a "Show lifespan" flip drops the preserved zoom so
 *    renderFanChart computes a fresh fit-to-window instead -- a lifespan
 *    toggle changes every wedge's own radius at once (RING-per-generation
 *    vs. death-year-minus-birth-year), so preserving the *transform*
 *    unchanged would still leave the dome a wildly different apparent size
 *    under it; re-fitting is the "reinit" the geometry actually needs;
 *  - a fresh *selection* (not just this handle being still-selected across
 *    an unrelated rebuild) asks renderFanChart to animate-center on it. */
export function FanChart({ ancestorTree, selectedHandle, onSelectPerson, sizeByLifespan, colorScheme }: FanChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const zoomRef = useRef<ZoomTransform | null>(null);
  const prevRootHandleRef = useRef<string | null>(null);
  const prevMaxDepthRef = useRef(0);
  const prevSelectedHandleRef = useRef<string | null>(null);
  const prevSizeByLifespanRef = useRef(sizeByLifespan);

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
    const existing = container.querySelector("svg");
    if (existing) zoomRef.current = zoomTransform(existing);

    const rootHandle = ancestorTree?.person?.handle ?? null;
    const maxDepth = treeMaxDepth(ancestorTree);
    const rootChanged = rootHandle !== prevRootHandleRef.current;
    const depthGrew = maxDepth > prevMaxDepthRef.current;
    const lifespanModeFlipped = sizeByLifespan !== prevSizeByLifespanRef.current;
    const justSelected = selectedHandle !== null && selectedHandle !== prevSelectedHandleRef.current;
    prevRootHandleRef.current = rootHandle;
    prevMaxDepthRef.current = maxDepth;
    prevSizeByLifespanRef.current = sizeByLifespan;
    prevSelectedHandleRef.current = selectedHandle;

    // A fresh root/deeper tree/mode flip wins over a same-render select --
    // shouldn't coincide in practice, but a re-fit is the more fundamental
    // geometry change of the two.
    const shouldFit = rootChanged || depthGrew || lifespanModeFlipped;

    const svg = renderFanChart(ancestorTree, {
      bboxWidth: size.width,
      bboxHeight: size.height,
      initialZoom: shouldFit ? null : zoomRef.current,
      selectedHandle,
      onSelectPerson,
      sizeByLifespan,
      colorScheme,
      centerHandle: selectedHandle,
      centerOnSelect: justSelected && !shouldFit,
    });
    container.replaceChildren(svg);
  }, [ancestorTree, size.width, size.height, selectedHandle, onSelectPerson, sizeByLifespan, colorScheme]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
