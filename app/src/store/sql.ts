// Pure SQL-string builders for a ViewConfig's local SQLite mirror table --
// no sql.js/DOM/network dependency, so these are plain-function testable
// (see __tests__/sql.test.ts). Ported from the original Layer 2/3 spike's
// browser.ts (since removed, see git history).
import type { ColumnConfig, ViewConfig } from "./views";

export function toSelectEntry(column: ColumnConfig): string | { json_path: (string | number)[]; as: string } {
  if (typeof column.select === "string") return column.select;
  return { ...column.select, as: column.key };
}

export function createTableSql(view: ViewConfig): string {
  const cols = view.columns.map((c) => `  ${c.key} ${c.sqlType}`).join(",\n");
  // No index on the order column -- viewStore.ts's getRows()/getHandleAt()
  // read back by `rowid` (insertion order, which already matches the
  // server's own sort) rather than re-sorting locally by this column, so
  // there's nothing here for an index on it to speed up.
  return `
    CREATE TABLE ${view.key} (
      handle TEXT PRIMARY KEY,
    ${cols}
    );
  `;
}

export function insertSql(view: ViewConfig): string {
  const names = ["handle", ...view.columns.map((c) => c.key)];
  const placeholders = names.map(() => "?").join(", ");
  return `INSERT INTO ${view.key} (${names.join(", ")}) VALUES (${placeholders});`;
}

// Used only for a live-sync patch to a row already in the cache (see
// viewStore.ts's applyLiveChange) -- a real UPDATE rather than the
// INSERT-OR-REPLACE this used to be, so the row keeps its existing rowid
// (and thus its local sort position/index) instead of being deleted and
// reinserted at the end of the table. See ViewStore.reconcileSelection()'s
// doc comment for why that matters.
export function updateSql(view: ViewConfig): string {
  const setClause = view.columns.map((c) => `${c.key} = ?`).join(", ");
  return `UPDATE ${view.key} SET ${setClause} WHERE handle = ?;`;
}

/** Maps a query-result item's raw values into the ordered value list a
 * prepared insert statement expects, applying each column's toSql
 * converter where present. */
export function toRowValues(view: ViewConfig, item: Record<string, unknown> & { handle: string }): (string | number | null)[] {
  return [
    item.handle,
    ...view.columns.map((c) => {
      const raw = item[c.key];
      return c.toSql ? c.toSql(raw, item) : (raw as string | number | null | undefined) ?? null;
    }),
  ];
}

/** Same values as toRowValues, reordered for updateSql()'s placeholder
 * order -- SET columns first, handle last (the WHERE clause), instead of
 * handle first (an INSERT's column order). */
export function toUpdateRowValues(view: ViewConfig, item: Record<string, unknown> & { handle: string }): (string | number | null)[] {
  const [handle, ...rest] = toRowValues(view, item);
  return [...rest, handle];
}
