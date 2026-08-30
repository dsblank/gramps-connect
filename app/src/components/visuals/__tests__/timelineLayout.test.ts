import { describe, expect, it } from "vitest";
import {
  axisTicks, domainLimit, fullDomain, hitTest, layoutTimeline, panDomain, tickLabel, zoomDomain,
} from "../timelineLayout";
import type { TimelineEvent } from "../../../store/visualData";

function event(year: number, type = "Birth", handle = `h${year}`): TimelineEvent {
  return {
    handle, grampsId: `E${year}`, type, description: "", placeTitle: "", dateText: String(year), year,
    datePreposition: "in",
  };
}

const OPTIONS = { width: 100, height: 100, radius: 4 } as const;

describe("layoutTimeline", () => {
  it("drops events outside the visible domain and counts the rest", () => {
    const events = [event(1800), event(1900), event(2000)];
    const layout = layoutTimeline(events, { ...OPTIONS, domain: [1850, 1950] });
    expect(layout.visibleCount).toBe(1);
    expect(layout.dots.map((d) => d.event.year)).toEqual([1900]);
  });

  it("treats the domain as half-open, so an event on the end bound is excluded", () => {
    const layout = layoutTimeline([event(1900)], { ...OPTIONS, domain: [1800, 1900] });
    expect(layout.visibleCount).toBe(0);
  });

  it("stacks same-column events upward with a gap, not on top of each other", () => {
    // Three events close enough together to share one 10px-wide column.
    const events = [event(1900, "Birth", "a"), event(1900.05, "Birth", "b"), event(1900.1, "Birth", "c")];
    const layout = layoutTimeline(events, { ...OPTIONS, domain: [1900, 2000] });
    expect(layout.dots).toHaveLength(3);
    // Same x (the column centre), strictly increasing height off the baseline.
    expect(new Set(layout.dots.map((d) => d.cx)).size).toBe(1);
    const ys = layout.dots.map((d) => d.cy);
    expect(ys[0]).toBeGreaterThan(ys[1]);
    expect(ys[1]).toBeGreaterThan(ys[2]);
    expect(ys[0] - ys[1]).toBe(OPTIONS.radius * 2 + 2);
  });

  it("summarizes a column taller than the plot as overflow rather than dropping it", () => {
    // A 40px-tall plot fits (40 - 4 - 2 - 16) / 10 = 1 dot per column.
    const events = Array.from({ length: 6 }, (_, i) => event(1900 + i * 0.01, "Birth", `h${i}`));
    const layout = layoutTimeline(events, { ...OPTIONS, height: 40, domain: [1900, 2000] });
    expect(layout.visibleCount).toBe(6);
    expect(layout.dots.length + layout.overflow[0].count).toBe(6);
    expect(layout.overflow).toHaveLength(1);
  });

  it("categorizes each dot, folding an unlisted type into Other", () => {
    const layout = layoutTimeline(
      [event(1900, "Birth"), event(1920, "Burial"), event(1940, "Census")],
      { ...OPTIONS, domain: [1890, 1950] },
    );
    expect(layout.dots.map((d) => d.category)).toEqual(["birth", "death", "other"]);
  });

  it("returns nothing for a degenerate domain or an unmeasured plot", () => {
    expect(layoutTimeline([event(1900)], { ...OPTIONS, domain: [1900, 1900] }).dots).toEqual([]);
    expect(layoutTimeline([event(1900)], { ...OPTIONS, width: 0, domain: [1800, 2000] }).dots).toEqual([]);
  });
});

describe("axisTicks", () => {
  it("picks a round step that yields roughly the target number of ticks", () => {
    const ticks = axisTicks([1800, 2000], 800);
    expect(ticks.map((t) => t.label)).toEqual(["1800", "1825", "1850", "1875", "1900", "1925", "1950", "1975"]);
  });

  it("marks whole centuries as major", () => {
    const ticks = axisTicks([1800, 2000], 800);
    expect(ticks.filter((t) => t.major).map((t) => t.label)).toEqual(["1800", "1900"]);
  });

  it("falls back to yearly ticks on a span too short for any coarser step", () => {
    const ticks = axisTicks([1900, 1903], 400);
    expect(ticks.map((t) => t.label)).toEqual(["1900", "1901", "1902"]);
  });

  it("spells out BC for negative years", () => {
    expect(tickLabel(-44)).toBe("44 BC");
    expect(tickLabel(1900)).toBe("1900");
  });
});

describe("fullDomain", () => {
  it("brackets every event with a little padding", () => {
    const [start, end] = fullDomain([event(1800), event(2000)]);
    expect(start).toBeLessThan(1800);
    expect(end).toBeGreaterThan(2000);
  });

  it("widens a single-event tree into a range that can actually be drawn", () => {
    expect(fullDomain([event(1900)])).toEqual([1895, 1905]);
  });

  it("falls back to a recent window when there's nothing to fit", () => {
    const [start, end] = fullDomain([]);
    expect(end - start).toBe(201);
  });
});

describe("zoomDomain", () => {
  const limit: [number, number] = [1000, 2000];

  it("holds the anchor point fixed while narrowing the span", () => {
    // Anchor 0.5 on [1800, 1900] is 1850; halving the span must keep it there.
    expect(zoomDomain([1800, 1900], 0.5, 0.5, limit)).toEqual([1825, 1875]);
  });

  it("holds an off-centre anchor too", () => {
    // Anchor 0 is the left edge, which stays put.
    expect(zoomDomain([1800, 1900], 0.5, 0, limit)).toEqual([1800, 1850]);
  });

  it("never zooms in past a one-year span", () => {
    const [start, end] = zoomDomain([1900, 1900.5], 0.5, 0.5, limit);
    expect(end - start).toBe(1);
  });

  it("clamps zooming out to the limit rather than running past it", () => {
    expect(zoomDomain([1400, 1600], 100, 0.5, limit)).toEqual(limit);
  });

  it("slides back inside the limit instead of squashing the requested span", () => {
    // Zooming out at the very right edge keeps the full 200-year span asked
    // for, by sliding left.
    expect(zoomDomain([1900, 2000], 2, 1, limit)).toEqual([1800, 2000]);
  });
});

describe("panDomain", () => {
  const limit: [number, number] = [1000, 2000];

  it("slides by a fraction of the current span, preserving it", () => {
    expect(panDomain([1800, 1900], 0.5, limit)).toEqual([1850, 1950]);
  });

  it("stops at the limit rather than panning into nothing", () => {
    expect(panDomain([1900, 2000], 0.5, limit)).toEqual([1900, 2000]);
    expect(panDomain([1000, 1100], -0.5, limit)).toEqual([1000, 1100]);
  });
});

describe("domainLimit", () => {
  it("is wider than the data's own extent, so there's always somewhere to pan", () => {
    const [dataStart, dataEnd] = fullDomain([event(1800), event(2000)]);
    const [limitStart, limitEnd] = domainLimit([event(1800), event(2000)]);
    expect(limitStart).toBeLessThan(dataStart);
    expect(limitEnd).toBeGreaterThan(dataEnd);
  });
});

describe("hitTest", () => {
  const dots = layoutTimeline(
    [event(1900, "Birth", "a"), event(1950, "Birth", "b")],
    { ...OPTIONS, width: 200, domain: [1890, 1960] },
  ).dots;

  it("finds a dot the pointer is directly over", () => {
    const target = dots[0];
    expect(hitTest(dots, target.cx, target.cy, 4)?.event.handle).toBe("a");
  });

  it("hits within the slack past the mark itself, so an 8px dot is reachable", () => {
    const target = dots[0];
    expect(hitTest(dots, target.cx + 6, target.cy, 4)?.event.handle).toBe("a");
    expect(hitTest(dots, target.cx + 40, target.cy, 4)).toBeNull();
  });

  it("picks the nearest centre when two are both in reach", () => {
    const [a, b] = dots;
    const midpoint = (a.cx + b.cx) / 2;
    // Nudged toward b, with generous slack so both are candidates.
    expect(hitTest(dots, midpoint + 1, a.cy, 4, 200)?.event.handle).toBe("b");
  });
});
