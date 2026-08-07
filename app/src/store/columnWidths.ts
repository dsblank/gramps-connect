// Per-view column widths, persisted across the remounts App.tsx's
// key={`table-${view.key}`} triggers on every view switch (see
// DataTable.tsx). One localStorage blob, keyed first by view key then by
// column key -- column key rather than array index so a future reordering
// of a view's columns doesn't silently reapply an old width to the wrong
// column.
const STORAGE_KEY = "gramps-connect_column_widths";

type WidthsByView = Record<string, Record<string, number>>;

function readAll(): WidthsByView {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WidthsByView) : {};
  } catch {
    return {};
  }
}

export function getColumnWidths(viewKey: string): Record<string, number> | undefined {
  return readAll()[viewKey];
}

export function setColumnWidths(viewKey: string, widths: Record<string, number>): void {
  const all = readAll();
  all[viewKey] = widths;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
