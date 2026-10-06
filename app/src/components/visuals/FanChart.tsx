import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { zoomTransform, type ZoomTransform } from "d3-zoom";
import { ActionIcon, Tooltip } from "@mantine/core";
import { renderFanChart, resetFanRotation, treeMaxDepth, type FanColorScheme } from "../../charts/fanChart";
import { t } from "../../i18n/i18n";
import type { TreeNode } from "../../store/treeData";
import { useDisplayFormatVersion } from "../../store/placeIndex";

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
  /** TreeView.tsx's own "Flip labels" checkbox. */
  flipLabels: boolean;
}

/** Imperative escape hatch for whatever needs the chart's own live `<svg>`
 * without owning its render loop -- today that's TreeView.tsx's own
 * DownloadImageButton (getSvg -- see DownloadImageButton.tsx's own doc
 * comment on why this has to be a callback, not a ref captured once). */
export interface FanChartHandle {
  getSvg: () => SVGSVGElement | null;
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
export const FanChart = forwardRef<FanChartHandle, FanChartProps>(function FanChart(
  { ancestorTree, selectedHandle, onSelectPerson, sizeByLifespan, colorScheme, flipLabels },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Wedge dates format per the display settings (lifeEventDates.ts); redraw
  // when those, or the Events cache they read from, change.
  const displayVersion = useDisplayFormatVersion();
  const zoomRef = useRef<ZoomTransform | null>(null);
  const rotationRef = useRef(0);
  // Mirrors fanChart.ts's own live `rotation` for the compass button only --
  // the render effect below never depends on it, so a drag updating it
  // every mousemove doesn't rebuild the chart.
  const [rotation, setRotation] = useState(0);
  const prevRootHandleRef = useRef<string | null>(null);
  const prevMaxDepthRef = useRef(0);
  const prevSelectedHandleRef = useRef<string | null>(null);
  const prevSizeByLifespanRef = useRef(sizeByLifespan);

  useImperativeHandle(ref, () => ({
    getSvg: () => containerRef.current?.querySelector("svg") ?? null,
  }), []);

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
    if (existing) {
      zoomRef.current = zoomTransform(existing);
      // fanChart.ts's own composeTransform has nothing built in to
      // zoomTransform for this -- Ctrl+Click rotation lives in a plain
      // `data-fan-rotation` attribute instead, read back the same way.
      const rotationAttr = existing.getAttribute("data-fan-rotation");
      if (rotationAttr !== null) rotationRef.current = Number(rotationAttr);
    }

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
      // Unlike initialZoom, never gated behind shouldFit -- rotation is a
      // viewing preference orthogonal to the fit-triggering geometry changes
      // (fanChart.ts's own doc comment on FanChartOptions.initialRotation).
      initialRotation: rotationRef.current,
      onRotationChange: setRotation,
      selectedHandle,
      onSelectPerson,
      sizeByLifespan,
      colorScheme,
      flipLabels,
      centerHandle: selectedHandle,
      centerOnSelect: justSelected && !shouldFit,
    });
    container.replaceChildren(svg);
  }, [ancestorTree, size.width, size.height, selectedHandle, onSelectPerson, sizeByLifespan, colorScheme, flipLabels, displayVersion]);

  const wrapped = ((rotation % 360) + 360) % 360;
  const rotated = wrapped > 0.01 && wrapped < 359.99;

  // The compass sits *beside* containerRef's div rather than inside it --
  // the render effect's replaceChildren would otherwise wipe it out on
  // every rebuild.
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {rotated && (
        <Tooltip label={t("Reset rotation")} withArrow position="left">
          <ActionIcon
            variant="default"
            size="lg"
            radius="xl"
            aria-label={t("Reset rotation")}
            style={{ position: "absolute", top: 8, right: 8 }}
            onClick={() => {
              const svg = containerRef.current?.querySelector("svg");
              if (svg) resetFanRotation(svg);
            }}
          >
            <CompassNeedle degrees={rotation} />
          </ActionIcon>
        </Tooltip>
      )}
    </div>
  );
});

/** A two-tone compass needle (red end = the chart's own "up"), tilted by
 * the same angle the chart is -- so it shows at a glance which way and how
 * far the fan is turned, Google Maps compass style. */
function CompassNeedle({ degrees }: { degrees: number }) {
  return (
    <svg width="18" height="18" viewBox="-10 -10 20 20" style={{ transform: `rotate(${degrees}deg)` }} aria-hidden>
      <path d="M0 -9 L4 0 L-4 0 Z" fill="var(--mantine-color-red-6)" />
      <path d="M0 9 L4 0 L-4 0 Z" fill="var(--mantine-color-dimmed)" />
    </svg>
  );
}
