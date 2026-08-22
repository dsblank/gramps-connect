import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ActionIcon, Box, Paper, Stack, Text, Tooltip } from "@mantine/core";
import { useComputedColorScheme } from "@mantine/core";
import type { TimelineEvent } from "../../store/visualData";
import { dotStyle } from "./eventCategories";
import { readVisualColors } from "./cssVar";
import {
  domainLimit, fullDomain, hitTest, layoutTimeline, panDomain, tickLabel, zoomDomain,
  type Dot, type TimelineLayout,
} from "./timelineLayout";
import { t } from "../../i18n/i18n";

/** Marker radius. The mark spec's floor is an 8px marker (r >= 4); this is
 * exactly that, because the dot-stack's whole point is packing as many
 * individually-hittable dots into a column as the plot is tall enough for. */
const DOT_RADIUS = 4;
/** Height of the axis strip below the plot -- tick labels live in the DOM
 * there rather than on the canvas, so they get real theme typography and stay
 * crisp without any devicePixelRatio arithmetic. */
const AXIS_HEIGHT = 26;
/** One wheel notch. Below ~1.15 the zoom feels unresponsive; above ~1.3 it
 * overshoots what the user was aiming at. */
const WHEEL_FACTOR = 1.2;
const BUTTON_FACTOR = 1.6;
/** Arrow-key pan, as a fraction of the visible span. */
const KEY_PAN = 0.15;

interface TimelineChartProps {
  /** Already filtered by TimelineView's category/text filters -- this component
   * plots exactly what it's given. */
  events: TimelineEvent[];
  /** Full unfiltered set, so zooming out reaches the whole tree's extent
   * rather than only the filtered subset's -- otherwise turning a category
   * off would silently re-scale the axis under the user, and turning it back
   * on wouldn't restore the frame. */
  allEvents: TimelineEvent[];
  /** In-context scope mode (see ScopeChip): every dot stays plotted and
   * hoverable, but only these are drawn at full strength. Undefined means
   * "no scope" -- the whole-tree default. */
  highlighted?: Set<string>;
  /** A year range to jump the frame to, for arriving with a scope. Applied
   * whenever its values change, so re-scoping re-frames but panning away
   * afterwards isn't fought. */
  focus?: [number, number] | null;
  /** The dot to ring as selected, so the record the detail card is
   * describing stays findable once the pointer has moved away. */
  selectedHandle?: string | null;
  /** A click *selects* -- it doesn't navigate. Null when the click landed
   * on bare plot, which dismisses the card. See the positional rule in this
   * component's doc comment. */
  onSelectEvent: (event: TimelineEvent | null) => void;
}

/** Full strength, or receded to context. Lower than the map's equivalent
 * because a dot is a much smaller mark than a marker and the dots pack
 * tightly -- at the map's 0.15 the un-scoped mass still reads as a solid
 * band rather than as background. */
const DIM_ALPHA = 0.12;

interface HoverState {
  dot: Dot;
  /** Pointer position within the plot, for placing the tooltip. */
  x: number;
  y: number;
}

/** A zoomable, pannable dot-stack of events over time, drawn to a canvas.
 *
 * Canvas rather than SVG because the marks are the whole chart and there can
 * be thousands of them in one frame: a React element per dot would re-
 * reconcile the entire plot on every pan frame. Nothing is lost to
 * accessibility by that choice here -- the dots aren't focusable individually
 * in the SVG version either, the chart is keyboard-drivable (arrows pan, +/-
 * zoom), and the same events are a real, screen-readable table one view away
 * in Events, which is the table view this chart's relief rule points at.
 *
 * The layout is a Wilkinson-style dot stack: events are quantized into
 * columns one marker wide and stacked upward, so a column's height *is* the
 * local event density while every dot in it stays a distinct, hoverable,
 * clickable record. That replaces the two separate mechanisms gramps-web's
 * timeline uses for the same job -- a single overlapping row of dots plus a
 * kernel-density band above it -- with one, and means density is legible at
 * any zoom without needing the band.
 *
 * Hovering names a dot; clicking *selects* it into the detail card beside
 * the plot, and only that card's own button leaves for the Events view.
 * That's the same positional rule the map and the aside's two panes follow
 * -- clicking in the plot previews, clicking in the preview commits -- and
 * this chart used to break it by navigating away on the first click, which
 * made a mis-aimed click on a dense column an unwanted page change. */
export function TimelineChart({
  events, allEvents, highlighted, focus, selectedHandle, onSelectEvent,
}: TimelineChartProps) {
  const colorScheme = useComputedColorScheme("light");
  const dark = colorScheme === "dark";
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const limit = useMemo(() => domainLimit(allEvents), [allEvents]);
  const [domain, setDomain] = useState<[number, number]>(() => fullDomain(allEvents));
  const [hover, setHover] = useState<HoverState | null>(null);

  // Reset the frame when the underlying dataset's extent changes (the first
  // load resolving, or a background-fill page widening it) -- but not when
  // the *filters* change, which is why this keys on allEvents. Without it the
  // initial render would be stuck on the empty-data default domain.
  useEffect(() => {
    setDomain(fullDomain(allEvents));
  }, [allEvents]);

  // Frame the scope on arrival. Deliberately *after* the reset above in
  // source order but keyed on its own values, so a scoped open that also
  // resolves allEvents for the first time settles on the scope's range
  // rather than the whole tree's. Clamped to the data's own limit so a
  // single-event scope doesn't zoom past what the axis can express.
  const focusFrom = focus?.[0];
  const focusTo = focus?.[1];
  useEffect(() => {
    if (focusFrom === undefined || focusTo === undefined) return;
    setDomain(zoomDomain([focusFrom, focusTo], 1, 0.5, limit));
  }, [focusFrom, focusTo, limit]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: Math.max(0, entry.contentRect.height - AXIS_HEIGHT),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout: TimelineLayout = useMemo(
    () => layoutTimeline(events, {
      domain,
      width: size.width,
      height: size.height,
      radius: DOT_RADIUS,
    }),
    [events, domain, size.width, size.height],
  );

  // Draw. Depends on the resolved theme tokens too (via colorScheme), so
  // flipping light/dark repaints rather than leaving a stale-coloured plot.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    const colors = readVisualColors();

    // Recessive hairline gridlines, one per axis tick, drawn under the marks.
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    for (const tick of layout.ticks) {
      // Half-pixel offset so a 1px line lands on one device row instead of
      // straddling two and rendering as a 2px blur.
      const x = Math.round(tick.x) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.height);
      ctx.stroke();
    }

    // No surface ring per dot: the layout already leaves a 2px gap between
    // every pair of neighbours, and the gap is the separator the mark spec
    // asks for. The ring exists for marks that overlap, which these don't --
    // it's spent on the hovered dot below instead, where it does work.
    ctx.lineWidth = 2;
    for (const dot of layout.dots) {
      const style = dotStyle(dot.category, dark, colors.muted);
      // Alpha rather than a washed-out colour, so a dimmed dot keeps its
      // category hue (and so the legend still describes it) while receding.
      ctx.globalAlpha = highlighted && !highlighted.has(dot.event.handle) ? DIM_ALPHA : 1;
      ctx.beginPath();
      ctx.arc(dot.cx, dot.cy, DOT_RADIUS, 0, Math.PI * 2);
      if (style.fill) {
        ctx.fillStyle = style.fill;
        ctx.fill();
      } else {
        // "Other": a hollow ring, so the catch-all recedes and never
        // competes as a fourth categorical colour. See eventCategories.ts.
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.lineWidth = 2;
      }
    }
    ctx.globalAlpha = 1;

    // "+N" for a column taller than the plot. Text wears a text token, never
    // a series colour -- and labelled selectively: adjacent full columns are
    // only ~10px apart, so labelling every one produces an illegible smear of
    // overlapping numbers ("+19 +9 2621+3714763"). Each label claims the width
    // it measures and the next one is skipped until there's clear space, so
    // what does get drawn is readable and the rest is carried by the columns
    // themselves being visibly full.
    if (layout.overflow.length > 0) {
      ctx.fillStyle = colors.muted;
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      let claimedUntil = -Infinity;
      for (const item of layout.overflow) {
        const text = `+${item.count}`;
        const halfWidth = ctx.measureText(text).width / 2;
        if (item.cx - halfWidth < claimedUntil) continue;
        ctx.fillText(text, item.cx, item.cy);
        claimedUntil = item.cx + halfWidth + 6;
      }
    }

    if (hover) {
      const style = dotStyle(hover.dot.category, dark, colors.muted);
      ctx.beginPath();
      ctx.arc(hover.dot.cx, hover.dot.cy, DOT_RADIUS + 2, 0, Math.PI * 2);
      ctx.strokeStyle = style.fill ?? style.stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // The selected dot, ringed in ink rather than in its own series colour
    // -- it has to stay findable after the pointer has left, and read as
    // distinct from the hover ring above, which wears the series colour.
    // Drawn last so it survives a dot being both hovered and selected.
    if (selectedHandle) {
      const dot = layout.dots.find((d) => d.event.handle === selectedHandle);
      if (dot) {
        ctx.beginPath();
        ctx.arc(dot.cx, dot.cy, DOT_RADIUS + 4, 0, Math.PI * 2);
        ctx.strokeStyle = colors.text;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }, [layout, size.width, size.height, dark, colorScheme, hover, highlighted, selectedHandle]);

  const zoomBy = useCallback((factor: number, anchor = 0.5) => {
    setDomain((current) => zoomDomain(current, factor, anchor, limit));
  }, [limit]);

  // Wheel zoom, anchored so the year under the cursor stays under the cursor.
  // Attached natively rather than via onWheel because React's wheel listener
  // is passive -- preventDefault() there is ignored and the page scrolls
  // behind the chart instead of the chart zooming.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = element!.getBoundingClientRect();
      const anchor = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
      zoomBy(e.deltaY > 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR, Math.min(Math.max(anchor, 0), 1));
    }
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  // Drag-pan. `moved` is what separates a pan from a click: a pointerup that
  // never travelled is a click on whatever dot is under it.
  const dragRef = useRef<{ x: number; domain: [number, number]; moved: boolean } | null>(null);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, domain, moved: false };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const drag = dragRef.current;
    if (drag) {
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 2) drag.moved = true;
      if (drag.moved && rect.width > 0) {
        // Drag right = move back in time, like dragging a map.
        setDomain(panDomain(drag.domain, -dx / rect.width, limit));
        setHover(null);
      }
      return;
    }
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dot = y <= size.height ? hitTest(layout.dots, x, y, DOT_RADIUS) : null;
    setHover((current) => {
      if (!dot) return current === null ? current : null;
      if (current?.dot.event.handle === dot.event.handle) return { dot, x, y };
      return { dot, x, y };
    });
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dot = hitTest(layout.dots, e.clientX - rect.left, e.clientY - rect.top, DOT_RADIUS);
    // A click on bare plot passes null, which dismisses the card -- the
    // same way clicking bare map does.
    onSelectEvent(dot ? dot.event : null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case "ArrowLeft": setDomain((d) => panDomain(d, -KEY_PAN, limit)); break;
      case "ArrowRight": setDomain((d) => panDomain(d, KEY_PAN, limit)); break;
      case "+": case "=": zoomBy(1 / BUTTON_FACTOR); break;
      case "-": zoomBy(BUTTON_FACTOR); break;
      case "Home": setDomain(fullDomain(allEvents)); break;
      default: return;
    }
    e.preventDefault();
  }

  const spanYears = domain[1] - domain[0];

  return (
    <Stack gap={0} style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <Box
        ref={containerRef}
        tabIndex={0}
        role="img"
        aria-label={
          `Timeline of ${events.length} events from ${tickLabel(Math.round(domain[0]))} ` +
          `to ${tickLabel(Math.round(domain[1]))}. Arrow keys pan, plus and minus zoom.`
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          cursor: hover ? "pointer" : "grab",
          touchAction: "none",
          outline: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ position: "absolute", inset: 0, width: "100%", height: size.height }}
        />
        {/* Tick labels in the DOM, positioned against the same scale the
            canvas drew its gridlines with. */}
        <Box style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: AXIS_HEIGHT }}>
          {layout.ticks.map((tick) => (
            <Text
              key={tick.label}
              size="xs"
              c="dimmed"
              fw={tick.major ? 600 : 400}
              style={{
                position: "absolute",
                left: tick.x,
                top: 4,
                transform: "translateX(-50%)",
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              {tick.label}
            </Text>
          ))}
        </Box>
        {hover && <DotTooltip hover={hover} width={size.width} height={size.height} />}
      </Box>

      {/* Zoom controls, bottom-right over the plot -- same placement and
          same three actions as gramps-web's timeline. */}
      <Stack gap={4} style={{ position: "absolute", right: 8, bottom: AXIS_HEIGHT + 8, zIndex: 2 }}>
        <Tooltip label={t("Zoom in")} position="left" withArrow>
          <ActionIcon variant="default" onClick={() => zoomBy(1 / BUTTON_FACTOR)} aria-label="Zoom in">+</ActionIcon>
        </Tooltip>
        <Tooltip label={`Fit all (${Math.round(spanYears)} years shown)`} position="left" withArrow>
          <ActionIcon variant="default" onClick={() => setDomain(fullDomain(allEvents))} aria-label="Fit all">⤢</ActionIcon>
        </Tooltip>
        <Tooltip label={t("Zoom out")} position="left" withArrow>
          <ActionIcon variant="default" onClick={() => zoomBy(BUTTON_FACTOR)} aria-label="Zoom out">−</ActionIcon>
        </Tooltip>
      </Stack>
    </Stack>
  );
}

/** Per-mark hover label, flipped away from whichever edge the cursor is
 * near so it never runs off the plot. Both axes need it: the columns are
 * densest at the recent (right-hand) end, and every column stacks up from the
 * baseline, so the most-hovered dots of all are the ones in the bottom-right
 * corner -- anchoring the box's top below the cursor there put most of it
 * off the bottom of the frame, with the last line of text cut off.
 *
 * Identity only -- type and date, the least that distinguishes this dot from
 * its neighbours in a stack. The full record is one click away in the detail
 * card, exactly as the map's hover gives a place's name and its card gives
 * the rest. This used to carry the whole record instead, which put the
 * timeline's disclosure a step ahead of the map's for no reason and meant a
 * pointer sweep across a dense column strobed a large box. */
function DotTooltip({ hover, width, height }: { hover: HoverState; width: number; height: number }) {
  const { dot, x, y } = hover;
  const flipX = x > width - 260;
  const flipY = y > height / 2;
  return (
    <Paper
      withBorder
      shadow="sm"
      px="xs"
      py={4}
      style={{
        position: "absolute",
        left: flipX ? undefined : x + 12,
        right: flipX ? width - x + 12 : undefined,
        top: flipY ? undefined : Math.max(4, y - 12),
        bottom: flipY ? Math.max(4, height - y - 12) : undefined,
        maxWidth: 240,
        pointerEvents: "none",
        zIndex: 3,
      }}
    >
      <Text size="xs" fw={600}>
        {dot.event.type || "Event"}
        {dot.event.dateText && (
          <Text span size="xs" c="dimmed" fw={400}>{" · "}{dot.event.dateText}</Text>
        )}
      </Text>
    </Paper>
  );
}
