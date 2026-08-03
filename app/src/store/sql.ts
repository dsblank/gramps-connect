// Pure SQL-string builders for a ViewConfig's local SQLite mirror table --
// no sql.js/DOM/network dependency, so these are plain-function testable
// (see __tests__/sql.test.ts). Ported from
// layer2-local-cache/client/src/browser.ts.
import type { ColumnConfig, ViewConfig } from "./views";

export function toSelectEntry(column: ColumnConfig): string | { json_path: (string | number)[]; as: string } {
  if (typeof column.select === "string") return column.select;
  return { ...column.select, as: column.key };
}

export function createTableSql(view: ViewConfig): string {
  const cols = view.columns.map((c) => `  ${c.key} ${c.sqlType}`).join(",\n");
  const orderCol = view.orderBy[0]?.column;
  const index = orderCol ? `CREATE INDEX ${view.key}_${orderCol} ON ${view.key}(${orderCol});` : "";
  return `
    CREATE TABLE ${view.key} (
      handle TEXT PRIMARY KEY,
    ${cols}
    );
    ${index}
  `;
}

export function insertSql(view: ViewConfig): string {
  const names = ["handle", ...view.columns.map((c) => c.key)];
  const placeholders = names.map(() => "?").join(", ");
  return `INSERT INTO ${view.key} (${names.join(", ")}) VALUES (${placeholders});`;
}

// Used only for a live-sync patch (see viewStore.ts's applyLiveChange) -- a
// bulk page fetch never needs REPLACE since it's always inserting into a
// fresh table, but a live-sync notification can legitimately name a row
// already in the cache (an UPDATE, or a reconnect that missed an earlier
// notification for it).
export function upsertSql(view: ViewConfig): string {
  const names = ["handle", ...view.columns.map((c) => c.key)];
  const placeholders = names.map(() => "?").join(", ");
  return `INSERT OR REPLACE INTO ${view.key} (${names.join(", ")}) VALUES (${placeholders});`;
}

/** Maps a query-result item's raw values into the ordered value list a
 * prepared insert/upsert statement expects, applying each column's toSql
 * converter where present. */
export function toRowValues(view: ViewConfig, item: Record<string, unknown> & { handle: string }): (string | number | null)[] {
  return [
    item.handle,
    ...view.columns.map((c) => {
      const raw = item[c.key];
      return c.toSql ? c.toSql(raw) : (raw as string | number | null | undefined) ?? null;
    }),
  ];
}
