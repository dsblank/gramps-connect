// Pure layout math for the Timeline -- no React, no canvas, no DOM, so it's
// plain-function testable (see __tests__/timelineLayout.test.ts) the same way
// store/sql.ts is.
import { categoryOf, type EventCategory } from "./eventCategories";
import type { TimelineEvent } from "../../store/visualData";

/** Where the timeline puts one event. */
export interface Dot {
  event: TimelineEvent;
  category: EventCategory;
  cx: number;
  cy: number;
}

/** A bucket that had more events than the plot is tall enough to stack, so
 * the tail is summarized as "+N" above the column instead of being drawn
 * (or, worse, silently dropped). */
export interface Overflow {
  cx: number;
  cy: number;
  count: number;
}

export interface AxisTick {
  x: number;
  label: string;
  /** A round century/millennium gets the heavier label -- see tickLabel. */
  major: boolean;
}

export interface TimelineLayout {
  dots: Dot[];
  overflow: Overflow[];
  ticks: AxisTick[];
  /** Events inside the visible domain, drawn or overflowed -- what the
   * "showing N of M" readout reports. */
  visibleCount: number;
}

export interface LayoutOptions {
  /** Visible year range, [start, end). */
  domain: [number, number];
  /** Plot area in px, excluding the axis strip. */
  width: number;
  height: number;
  /** Marker radius. Kept at >= 4 (an 8px marker) per the mark spec. */
  radius: number;
}

/** Horizontal gap between adjacent dot columns, and vertical gap between
 * stacked dots -- the 2px surface gap that separates fills without drawing a
 * border to do it. */
const GAP = 2;
/** The plot never stacks right to its own top edge; this much headroom is
 * left for the "+N" overflow labels to sit in. */
const TOP_PADDING = 16;

export function layoutTimeline(events: TimelineEvent[], options: LayoutOptions): TimelineLayout {
  const { domain, width, height, radius } = options;
  const [start, end] = domain;
  const span = end - start;
  if (!(span > 0) || width <= 0 || height <= 0) {
    return { dots: [], overflow: [], ticks: [], visibleCount: 0 };
  }
  const toX = (year: number) => ((year - start) / span) * width;

  // One column per dot-width of screen, so a column is exactly as wide as
  // the marker it holds: dots in the same column sit vertically above each
  // other rather than overlapping, and the height of a column *is* the local
  // event density. Zooming in widens the year range each column covers less,
  // so tall columns progressively resolve into individual dots.
  const columnWidth = radius * 2 + GAP;
  const columnCount = Math.max(1, Math.ceil(width / columnWidth));
  const columns: TimelineEvent[][] = Array.from({ length: columnCount }, () => []);

  let visibleCount = 0;
  for (const event of events) {
    if (event.year < start || event.year >= end) continue;
    visibleCount += 1;
    // Clamped rather than skipped: an event exactly on the right edge would
    // otherwise index one past the last column.
    const column = Math.min(columnCount - 1, Math.floor(toX(event.year) / columnWidth));
    columns[column].push(event);
  }

  const baseline = height - radius - GAP;
  const maxStack = Math.max(1, Math.floor((baseline - TOP_PADDING) / (radius * 2 + GAP)));

  const dots: Dot[] = [];
  const overflow: Overflow[] = [];
  columns.forEach((columnEvents, index) => {
    if (columnEvents.length === 0) return;
    // Column centre, not each event's own x: that's what makes a column a
    // column. The dot's real date is still exact -- it's in the tooltip and
    // in the axis position of its column -- but its pixel is quantized, the
    // same trade any histogram makes.
    const cx = index * columnWidth + columnWidth / 2;
    const drawn = Math.min(columnEvents.length, maxStack);
    for (let i = 0; i < drawn; i += 1) {
      dots.push({
        event: columnEvents[i],
        category: categoryOf(columnEvents[i].type),
        cx,
        cy: baseline - i * (radius * 2 + GAP),
      });
    }
    if (columnEvents.length > drawn) {
      overflow.push({
        cx,
        cy: baseline - drawn * (radius * 2 + GAP),
        count: columnEvents.length - drawn,
      });
    }
  });

  return { dots, overflow, ticks: axisTicks(domain, width), visibleCount };
}

/** Candidate tick spacings in years, coarse to fine. Stops at 1: below a
 * one-year span the axis keeps whole-year ticks and simply shows fewer of
 * them, rather than switching to months -- a genealogical timeline zoomed
 * inside a single year is a rare enough state not to warrant a second
 * labelling scheme, and the dots' own tooltips carry the exact dates. */
const TICK_STEPS = [1000, 500, 250, 100, 50, 25, 10, 5, 2, 1];
/** Aim for roughly this many labelled ticks across the plot; the real count
 * lands nearby, since the step has to be one of the round numbers above. */
const TARGET_TICKS = 8;

export function axisTicks(domain: [number, number], width: number): AxisTick[] {
  const [start, end] = domain;
  const span = end - start;
  if (!(span > 0) || width <= 0) return [];
  const step = TICK_STEPS.find((candidate) => span / candidate >= TARGET_TICKS) ?? 1;
  const ticks: AxisTick[] = [];
  const first = Math.ceil(start / step) * step;
  for (let year = first; year < end; year += step) {
    ticks.push({
      x: ((year - start) / span) * width,
      label: tickLabel(year),
      major: year % 100 === 0,
    });
  }
  return ticks;
}

/** Years are shown plainly, with BC spelled out -- there's no year 0 in
 * Gramps' calendars, so a negative year is genuinely BC rather than an
 * offset. */
export function tickLabel(year: number): string {
  return year < 0 ? `${-year} BC` : String(year);
}

/** The domain that fits every event, with a little padding, or a sensible
 * default when there's nothing (or only one thing) to fit. Used for the
 * initial view and by the Reset button.
 *
 * Unlike gramps-web's timeline -- which opens zoomed to its *last ten*
 * events and expects you to zoom out -- this opens on the whole tree. The
 * dot-stack is readable at any density (a busy century is a tall column, not
 * a smear), so the full extent is a more useful first frame than a
 * fragment of it, and it's the frame that shows where the tree's data
 * actually is. */
export function fullDomain(events: TimelineEvent[]): [number, number] {
  if (events.length === 0) {
    const thisYear = new Date().getFullYear();
    return [thisYear - 200, thisYear + 1];
  }
  // events are pre-sorted by year (see visualData.ts).
  const min = events[0].year;
  const max = events[events.length - 1].year;
  if (max - min < 1) return [min - 5, min + 5];
  const padding = (max - min) * 0.02;
  return [min - padding, max + padding];
}

/** Rescales `domain` about a fixed point, for wheel zoom (the year under the
 * cursor stays under the cursor) and the zoom buttons (anchor 0.5, so the
 * centre holds). `anchor` is a 0..1 fraction across the plot.
 *
 * Clamped both ways: in to a one-year span (past which the dot-stack has
 * nothing left to resolve), out to `limit`, so scrolling can't strand the
 * view in empty millennia it then has to be scrolled back out of. */
export function zoomDomain(
  domain: [number, number],
  factor: number,
  anchor: number,
  limit: [number, number],
): [number, number] {
  const [start, end] = domain;
  const span = end - start;
  const limitSpan = limit[1] - limit[0];
  const nextSpan = Math.min(Math.max(span * factor, 1), limitSpan);
  const focus = start + span * anchor;
  let nextStart = focus - nextSpan * anchor;
  // Slide (rather than squash) back inside the limit, so the span the user
  // asked for is preserved when they zoom out at the very edge.
  nextStart = Math.min(Math.max(nextStart, limit[0]), limit[1] - nextSpan);
  return [nextStart, nextStart + nextSpan];
}

/** Slides `domain` by a fraction of its own span, for drag-pan and the
 * keyboard arrows. Clamped to `limit` like zoomDomain. */
export function panDomain(
  domain: [number, number],
  fraction: number,
  limit: [number, number],
): [number, number] {
  const span = domain[1] - domain[0];
  const shifted = Math.min(Math.max(domain[0] + span * fraction, limit[0]), limit[1] - span);
  return [shifted, shifted + span];
}

/** The pannable/zoomable extent: the data's own range, widened so there's
 * always somewhere to go at either end, and never narrower than the current
 * view. */
export function domainLimit(events: TimelineEvent[]): [number, number] {
  const [start, end] = fullDomain(events);
  const margin = (end - start) * 0.05;
  return [start - margin, end + margin];
}

/** Hit-tests a pointer against laid-out dots, nearest-centre-wins within a
 * radius. `slack` widens the target past the mark itself -- an 8px dot is a
 * small thing to hit, and the mark spec's 2px surface ring is part of the
 * hit area, not just spacing. */
export function hitTest(dots: Dot[], x: number, y: number, radius: number, slack = 4): Dot | null {
  const reach = radius + slack;
  let best: Dot | null = null;
  let bestDistance = Infinity;
  for (const dot of dots) {
    const dx = dot.cx - x;
    const dy = dot.cy - y;
    if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = dot;
    }
  }
  return best;
}
