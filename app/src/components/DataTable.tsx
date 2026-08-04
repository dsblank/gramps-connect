import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useViewStore } from "../hooks/useViewStore";
import { getViewStore } from "../store/registry";
import type { ViewConfig } from "../store/views";
import classes from "./DataTable.module.css";

// Virtualized scroll: the scroll container's inner spacer is sized to
// virtualizer.getTotalSize() (based on snapshot.totalCount), giving the
// real browser scrollbar correct proportions for the whole (server-side)
// dataset -- but only the rows actually in view are ever queried from
// local SQLite or rendered as DOM nodes. Replaces the original spike's
// hand-rolled spacer-div/translateY math with @tanstack/react-virtual.
const ROW_HEIGHT = 28;
const BUFFER_ROWS = 6;
const DEFAULT_COLUMN_WIDTH = 160;
const MIN_COLUMN_WIDTH = 60;

interface DataTableProps {
  view: ViewConfig;
}

export function DataTable({ view }: DataTableProps) {
  const snapshot = useViewStore(view.key);
  const store = getViewStore(view.key);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Visual-only row selection (highlight), no detail panel yet -- see
  // PLAN.md's roadmap note on the Gramps-desktop-style detail panel.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // Column widths are pure display state, reset on view switch (this
  // component is remounted per view, see App.tsx's key={`table-${...}`})
  // -- dragging a handle only ever touches this array, never row height,
  // so it can't affect the virtualizer's vertical math at all.
  const [colWidths, setColWidths] = useState<number[]>(() => view.columns.map(() => DEFAULT_COLUMN_WIDTH));

  const virtualizer = useVirtualizer({
    count: snapshot.totalCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: BUFFER_ROWS,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // One windowed SQL query per render pass (mirrors the original's
  // renderVisible(), a single LIMIT/OFFSET query per scroll frame) rather
  // than one query per row. Keyed on snapshot.revision, not just
  // loadedCount -- a live-sync UPDATE patches a row's *values* in place
  // without changing loadedCount/totalCount, so loadedCount alone misses
  // it (caught by an end-to-end smoke test: the store patched correctly,
  // but the table never re-rendered until revision was added).
  const rows = useMemo(() => {
    const map = new Map<number, unknown[]>();
    if (virtualItems.length === 0) return map;
    const first = virtualItems[0].index;
    const last = virtualItems[virtualItems.length - 1].index;
    const loadedLast = Math.min(last, snapshot.loadedCount - 1);
    if (loadedLast < first) return map;
    const values = store.getRows(first, loadedLast - first + 1);
    values.forEach((row, i) => map.set(first + i, row));
    return map;
  }, [store, virtualItems, snapshot.loadedCount, snapshot.revision]);

  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
  const gridColumns = colWidths.map((w) => `${w}px`).join(" ");
  const gridStyle = { "--grid-columns": gridColumns } as CSSProperties;

  function startResize(e: ReactPointerEvent<HTMLDivElement>, index: number) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[index];
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      const next = Math.max(MIN_COLUMN_WIDTH, startWidth + (ev.clientX - startX));
      setColWidths((prev) => (prev[index] === next ? prev : prev.map((w, i) => (i === index ? next : w))));
    }
    function onUp(ev: PointerEvent) {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  return (
    <div className={classes.tableWrapper}>
      <div className={`${classes.row} ${classes.header}`} style={{ ...gridStyle, width: totalWidth }}>
        {view.columns.map((col, index) => {
          // gramps-web-api's order_by only ever accepts a flat, same-table
          // column (see ViewConfig.orderBy's doc comment) -- a column
          // whose select is a json_path (birth_date, place_title, ...)
          // can't be sorted server-side, so it isn't made clickable.
          const sortColumn = typeof col.select === "string" ? col.select : null;
          const activeSort = snapshot.orderBy;
          const isSorted = sortColumn !== null && activeSort.column === sortColumn;
          return (
            <div
              key={col.key}
              className={`${classes.cell} ${classes.headerCell} ${sortColumn ? classes.sortable : ""}`}
              onClick={sortColumn ? () => store.setSort(sortColumn).catch(() => {}) : undefined}
            >
              <span>{col.label}</span>
              {isSorted && <span className={classes.sortArrow}>{activeSort.direction === "asc" ? "▲" : "▼"}</span>}
              <div
                className={classes.resizeHandle}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => startResize(e, index)}
              />
            </div>
          );
        })}
      </div>
      <div className={classes.scroll} ref={scrollRef} style={{ width: totalWidth }}>
        <div style={{ height: virtualizer.getTotalSize(), width: totalWidth, position: "relative" }}>
          {virtualItems.map((item) => {
            const rawRow = rows.get(item.index);
            const rowState = store.getRowState(item.index);
            return (
              <div
                key={item.key}
                className={classes.row}
                data-selected={item.index === selectedIndex || undefined}
                onClick={() => rawRow && setSelectedIndex(item.index)}
                style={{
                  ...gridStyle,
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: totalWidth,
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                {rawRow ? (
                  view.columns.map((col, i) => (
                    <div key={col.key} className={classes.cell}>
                      {col.toDisplay ? col.toDisplay(rawRow[i]) : rawRow[i] == null ? "" : String(rawRow[i])}
                    </div>
                  ))
                ) : (
                  <div className={classes.loadingRow}>
                    {rowState === "unloaded" ? "loading…" : "loading… (background fill hasn't reached this row yet)"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
