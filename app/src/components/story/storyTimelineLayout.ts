// Pure layout math for StoryTimelineStrip.tsx (moved to a distinctly-cased
// filename -- storyTimelineStrip.ts vs StoryTimelineStrip.tsx collided on
// case-insensitive filesystems, breaking Windows/macOS CI builds even though
// Linux's case-sensitive filesystem never saw a problem) -- deliberately not
// a reuse of
// visuals/timelineLayout.ts's own fullDomain: that function is typed to
// TimelineEvent[] (and assumes its caller's pre-sorted-by-year array), which
// a story's dated slides aren't shaped like. axisTicks/tickLabel are
// generic over plain (domain, year) numbers, so those import directly
// instead of being re-derived here.
export { axisTicks, tickLabel } from "../visuals/timelineLayout";

/** The year range a strip covers, with the same little padding
 * visuals/timelineLayout.ts's fullDomain gives a busy plot, so a lone dot
 * (or two dots the same year) still sits on a real span rather than a
 * degenerate one. */
export function storyDomain(years: number[]): [number, number] {
  const min = Math.min(...years);
  const max = Math.max(...years);
  if (max - min < 1) return [min - 5, min + 5];
  const padding = (max - min) * 0.05;
  return [min - padding, max + padding];
}

/** Where a given year lands across a `width`-px strip for `domain`. */
export function xForYear(year: number, domain: [number, number], width: number): number {
  const [start, end] = domain;
  const span = end - start;
  if (!(span > 0)) return width / 2;
  return ((year - start) / span) * width;
}
