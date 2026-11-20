// Display order for a record's events: by date, without touching the
// stored event_ref_list (whose positions birth_ref_index/death_ref_index
// point into). New events are always appended, so stored order drifts
// from chronology; the Related Pane's Events section shows this instead.

type Dated = { date?: { sortval?: number } | null } | null | undefined;

function sortvalOf(target: unknown): number {
  const sortval = (target as Dated)?.date?.sortval;
  return typeof sortval === "number" ? sortval : 0;
}

/** `rows` with the dated ones put in date order. An undated row (sortval
 * 0) keeps its own slot, so an event someone deliberately placed between
 * others stays there; the dated rows fill the remaining slots, earliest
 * first, ties keeping their stored order. */
export function sortByEventDate<T extends { target: unknown }>(rows: T[]): T[] {
  const dated = rows
    .map((row, index) => ({ row, index, sortval: sortvalOf(row.target) }))
    .filter((r) => r.sortval !== 0)
    .sort((a, b) => a.sortval - b.sortval || a.index - b.index);
  let next = 0;
  return rows.map((row) => (sortvalOf(row.target) === 0 ? row : dated[next++].row));
}
