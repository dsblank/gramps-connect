// What clicking a list column's header sorts by. Every column sorts,
// except a Gramps type (stored as a number whose order isn't its name's), a
// whole record, and a column that opts out with `sortBy: null`. The keys
// are worked out from the column's `select` unless it names them
// (ColumnConfig.sortBy), then its `thenBy` (a second sort), then the view's own default
// order -- all at the clicked direction.
//
// A key read from inside each record (a date's sortval, a linked person's
// name, a custom column) can only be sorted cheaply on a small list:
// nothing indexes inside a record, so the server reads every row for each
// page. Such a column is `limited` -- it sorts while the list has at most
// SORT_ROW_LIMIT rows. Flat columns aren't, and neither are the view's own
// default-order keys, since every load of the list already pays for those.
import { columnExpression, customSortKeys } from "./columnSettings";
import { goqlNamespaceForEndpoint } from "./goqlCompletion";
import { defaultOrderBy, type ColumnConfig, type OrderBy, type ViewConfig } from "./views";

const FLAT_COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ColumnSort {
  /** Every order_by key, most significant first. */
  keys: string[];
  /** Sorts only while the list has at most SORT_ROW_LIMIT rows. */
  limited: boolean;
}

/** The keys a header click sorts `column` by before its `thenBy`, or null
 * when it can't be sorted. */
export function primarySortKeys(view: ViewConfig, column: ColumnConfig): string[] | null {
  const { sortBy, select } = column;
  if (sortBy === null) return null;
  if (typeof sortBy === "string") return [sortBy];
  if (typeof sortBy === "function") return sortBy();
  // A string select that isn't a bare column ("len(...) as x") can't be
  // sent as order_by.
  if (typeof select === "string") return FLAT_COLUMN_RE.test(select) ? [select] : null;
  const keys = customSortKeys(goqlNamespaceForEndpoint(view.endpoint) ?? "", columnExpression(column))?.();
  return keys && keys.length > 0 ? keys : null;
}

/** The keys `column`'s thenBy sorts by: a date by its sortval, a name by
 * its parts, a value by itself; none for a type or a whole record. */
export function thenByKeys(view: ViewConfig, column: ColumnConfig): string[] {
  const thenBy = column.thenBy?.trim();
  if (!thenBy) return [];
  return customSortKeys(goqlNamespaceForEndpoint(view.endpoint) ?? "", thenBy)?.() ?? [];
}

/** The column's full sort (null: not sortable). */
export function columnSort(view: ViewConfig, column: ColumnConfig): ColumnSort | null {
  const primary = primarySortKeys(view, column);
  if (!primary) return null;
  const defaults = defaultOrderBy(view).map((o) => o.column);
  const keys = [...new Set([...primary, ...thenByKeys(view, column), ...defaults])];
  const flat = new Set(
    view.columns.flatMap((c) => (typeof c.select === "string" && FLAT_COLUMN_RE.test(c.select) ? [c.select] : [])),
  );
  return { keys, limited: keys.some((key) => !flat.has(key) && !defaults.includes(key)) };
}

/** The key a header click sorts by first (null: not sortable) -- what
 * DataTable compares against the active sort to draw the arrow, and what
 * it passes to ViewStore.setSort(). */
export function headerSortColumn(view: ViewConfig, column: ColumnConfig): string | null {
  return primarySortKeys(view, column)?.[0] ?? null;
}

/** The column whose header sorts by `key` first: a shown one before a
 * hidden one (People's Name before the hidden Surname, which both start
 * with `surname`). */
export function sortColumnFor(view: ViewConfig, key: string): ColumnConfig | undefined {
  const matches = view.columns.filter((c) => headerSortColumn(view, c) === key);
  return matches.find((c) => !c.hidden) ?? matches[0];
}

/** `sort`'s keys, every one at `direction`. */
export function orderByFor(sort: ColumnSort, direction: OrderBy["direction"]): OrderBy[] {
  return sort.keys.map((column) => ({ column, direction }));
}

/** Where `view`'s cache holds the value of order_by key `column`, so a
 * row's rank can be worked out from it: a column caching exactly that (a
 * flat column under its own name, or a column whose select is that path),
 * or a column caching a whole structure the key walks into -- a date's
 * `sortval` inside the cached date (`birth.date.sortval` in Birth's
 * `birth.date`), walked as `rest`. Undefined for a key no column caches. */
export function locateSortKey(view: ViewConfig, column: string): { cached: ColumnConfig; rest: string[] } | undefined {
  const exact =
    view.columns.find((c) => c.key === column && typeof c.select === "string") ??
    view.columns.find((c) => typeof c.select === "object" && columnExpression(c) === column);
  if (exact) return { cached: exact, rest: [] };
  // The column that sorts by this key first (a name column, not a custom
  // column that merely selects the whole father), then any.
  const inside = (c: ColumnConfig) => typeof c.select === "object" && column.startsWith(`${columnExpression(c)}.`);
  const within =
    view.columns.find((c) => inside(c) && (primarySortKeys(view, c) ?? []).includes(column)) ?? view.columns.find(inside);
  return within ? { cached: within, rest: column.slice(columnExpression(within).length + 1).split(".") } : undefined;
}
