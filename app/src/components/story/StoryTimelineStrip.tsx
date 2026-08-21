// Pilot: "a line with years on it, and a dot" -- the simplest thing that
// shows where the current slide sits chronologically among the story's own
// dated slides, with a click-to-jump per dot since that's nearly free once
// the dot is there. SVG rather than visuals/TimelineChart.tsx's Canvas: a
// story holds at most a few dozen dated points, none of TimelineChart's
// pan/zoom/hit-testing complexity (which is what Canvas earns its keep on
// there) applies here, and SVG ticks/dots scale with the viewBox for free on
// resize instead of needing their pixel positions recomputed by hand.
import { useEffect, useRef, useState } from "react";
import { readVisualColors } from "../visuals/cssVar";
import { seriesColor } from "../visuals/eventCategories";
import { PIN_PATH_D } from "./storyMarker";
import { axisTicks, storyDomain, tickLabel, xForYear } from "./storyTimelineStrip";

const HEIGHT = 70;
const MARGIN = 28;
/** Where each point's pin-tip touches the axis -- pins stand on this line,
 * pointing down onto it, same as the map marker points down onto its
 * coordinate. */
const AXIS_Y = 42;
const LABEL_Y = 62;
const CURRENT_SCALE = 0.95;

export interface StoryTimelinePoint {
  index: number;
  year: number;
}

export function StoryTimelineStrip({ points, currentIndex, onSelect, dark }: {
  points: StoryTimelinePoint[];
  currentIndex: number;
  onSelect: (index: number) => void;
  dark: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const colors = readVisualColors();
  const mark = seriesColor(dark);
  const plotWidth = Math.max(0, width - MARGIN * 2);
  const domain = storyDomain(points.map((p) => p.year));
  const ticks = plotWidth > 0 ? axisTicks(domain, plotWidth) : [];

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute", left: 0, right: 0, bottom: 0, height: HEIGHT, background: colors.surface,
        // Above the content panel (z-index 1) -- otherwise any point that
        // falls under the panel's own x-range reads as fading, since the
        // panel's transparent-to-solid background paints over it.
        zIndex: 2,
      }}
    >
      {width > 0 && (
        <svg width={width} height={HEIGHT} style={{ display: "block", overflow: "visible" }}>
          <line x1={MARGIN} y1={AXIS_Y} x2={width - MARGIN} y2={AXIS_Y} stroke={colors.border} strokeWidth={1} />
          {ticks.map((tick) => (
            <text
              key={tick.x}
              x={MARGIN + tick.x}
              y={LABEL_Y}
              fontSize={15}
              fill={colors.muted}
              textAnchor="middle"
            >
              {tick.label}
            </text>
          ))}
          {points.map((point) => {
            const cx = MARGIN + xForYear(point.year, domain, plotWidth);
            const current = point.index === currentIndex;
            return current ? (
              <path
                key={point.index}
                d={PIN_PATH_D}
                transform={`translate(${cx - 12 * CURRENT_SCALE} ${AXIS_Y - 24 * CURRENT_SCALE}) scale(${CURRENT_SCALE})`}
                fill={mark}
                stroke={colors.text}
                strokeWidth={1.5}
                style={{ cursor: "pointer" }}
                onClick={() => onSelect(point.index)}
              >
                <title>{tickLabel(point.year)}</title>
              </path>
            ) : (
              <circle
                key={point.index}
                cx={cx}
                cy={AXIS_Y}
                r={3.5}
                fill={mark}
                stroke={colors.surface}
                strokeWidth={1.5}
                style={{ cursor: "pointer" }}
                onClick={() => onSelect(point.index)}
              >
                <title>{tickLabel(point.year)}</title>
              </circle>
            );
          })}
        </svg>
      )}
    </div>
  );
}
