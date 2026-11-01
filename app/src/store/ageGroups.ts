// Splits a newest-first list into "Today / Yesterday / Last 7 days / ..."
// runs, for View > Change Log (and later View > Visited). Calendar days in the
// viewer's own time zone, not 24-hour windows: something changed at 23:50
// is "Yesterday" ten minutes after midnight, the way people read it.

export type AgeGroupKey = "today" | "yesterday" | "week" | "month" | "older";

export const AGE_GROUP_LABELS: Record<AgeGroupKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Last 7 days",
  month: "Last 30 days",
  older: "Older",
};

export function ageGroupOf(unixSeconds: number, now: Date = new Date()): AgeGroupKey {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  if (unixSeconds >= midnight) return "today";
  // Date arithmetic rather than `midnight - day`, so a daylight-saving
  // change doesn't shift the boundary by an hour.
  const daysAgo = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n).getTime() / 1000;
  if (unixSeconds >= daysAgo(1)) return "yesterday";
  if (unixSeconds >= daysAgo(6)) return "week";
  if (unixSeconds >= daysAgo(29)) return "month";
  return "older";
}

/** Consecutive runs of `items` sharing an age group, in the order given --
 * the input is already newest first, so each group appears once. */
export function groupByAge<T>(
  items: T[],
  unixOf: (item: T) => number,
  now: Date = new Date(),
): { key: AgeGroupKey; items: T[] }[] {
  const groups: { key: AgeGroupKey; items: T[] }[] = [];
  for (const item of items) {
    const key = ageGroupOf(unixOf(item), now);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return groups;
}
