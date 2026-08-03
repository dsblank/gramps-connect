import { useMemo, useRef, useState, type CSSProperties } from "react";
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

  const gridColumns = `repeat(${view.columns.length}, 1fr)`;
  const gridStyle = { "--grid-columns": gridColumns } as CSSProperties;

  return (
    <div>
      <div className={`${classes.row} ${classes.header}`} style={gridStyle}>
        {view.columns.map((col) => (
          <div key={col.key} className={classes.cell}>{col.label}</div>
        ))}
      </div>
      <div className={classes.scroll} ref={scrollRef}>
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
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
                  right: 0,
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
