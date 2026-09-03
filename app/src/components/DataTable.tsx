import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useViewStore } from "../hooks/useViewStore";
import { getColumnWidths, setColumnWidths as saveColumnWidths } from "../store/columnWidths";
import { getViewStore } from "../store/registry";
import { visibleColumns, type ViewConfig } from "../store/views";
import { t } from "../i18n/i18n";
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
// A view can have well over 100k rows -- shift+click range-select is capped
// here (a UI-policy number ViewStore.selectRange() itself has no opinion
// on) so a stray shift+click near the top of a huge, freshly sorted view
// can't kick off a fetch/select of tens of thousands of rows. Past the cap
// the click is simply ignored -- selection stays exactly as it was.
const MAX_RANGE_SELECT = 50;

interface DataTableProps {
  view: ViewConfig;
}

export function DataTable({ view }: DataTableProps) {
  const snapshot = useViewStore(view.key);
  const store = getViewStore(view.key);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  // Everything below (widths, grid tracks, resize indices, cells) is indexed
  // by position in *this* list, not in view.columns -- a hidden column has no
  // track and no header to drag. The one exception is reading a value out of
  // a getRows() row, which is still indexed by the column's `index` into the
  // full list, since that's the order the cache table and its SELECT are
  // built in.
  const columns = useMemo(() => visibleColumns(view), [view]);
  // Column widths are pure display state, so nothing here affects the
  // virtualizer's vertical math -- but this component is remounted per view
  // (see App.tsx's key={`table-${...}`}), so the initial value is read back
  // from localStorage (see columnWidths.ts) rather than always starting at
  // DEFAULT_COLUMN_WIDTH, and startResize's onUp below writes it back out.
  const [colWidths, setColWidths] = useState<number[]>(() => {
    const saved = getColumnWidths(view.key);
    return columns.map(({ column }) => saved?.[column.key] ?? DEFAULT_COLUMN_WIDTH);
  });

  // The sticky header is a normal-flow sibling *inside* the same scroll
  // container as the virtualized rows (see classes.header's doc comment on
  // why -- it needs to track horizontal scroll). The virtualizer only knows
  // about scrollRef's raw scrollTop/clientHeight, which include that header
  // space; without telling it about it (scrollMargin), align: "auto" scrolls
  // (e.g. the arrow-key handler below, or navigateToHandle's jump-to-row)
  // undershoot by the header's height, leaving the target row's bottom
  // edge that far below the visible viewport instead of fully in view.
  // ROW_HEIGHT is the pre-measurement fallback (the header uses the same
  // fixed row height as any other row -- see DataTable.module.css's .row),
  // replaced with the real measured height once the ref is attached.
  const [headerHeight, setHeaderHeight] = useState(ROW_HEIGHT);
  useLayoutEffect(() => {
    const height = headerRef.current?.getBoundingClientRect().height;
    if (height) setHeaderHeight(height);
  }, []);

  const virtualizer = useVirtualizer({
    count: snapshot.totalCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: BUFFER_ROWS,
    scrollMargin: headerHeight,
    // scrollMargin above already bakes headerHeight into item.start (so a
    // row's own translateY draws it in the right place below the sticky
    // header) -- but align:"auto"/"start" scrolls (e.g. a live-sync
    // reposition, or navigateToHandle, moving selection to a row above the
    // current view) compute their target scrollTop as item.start minus
    // this, defaulting to 0. Without it, that target lands headerHeight
    // px too high: exactly the header's own sticky position, so the row
    // scrolls to directly underneath it -- selected but invisible.
    scrollPaddingStart: headerHeight,
  });

  const virtualItems = virtualizer.getVirtualItems();

  // A new sort or where_expr means the old scroll offset points at
  // unrelated rows in the new result set -- jump back to the top rather
  // than leaving the viewport wherever the user happened to be scrolled.
  useEffect(() => {
    virtualizer.scrollToOffset(0);
  }, [snapshot.whereExpr, snapshot.orderBy.column, snapshot.orderBy.direction]);

  // Following a person link in the detail panel (see ViewStore's
  // navigateToHandle) moves selection to a row that's very likely off-
  // screen -- scroll it into view. Rows are fixed-height (no measureElement
  // pass), so item.start/size can be computed directly instead of waiting
  // on virtualItems to include the target. Skipping the scroll when the row
  // is already fully visible is what keeps this from fighting a plain
  // in-view click's own select() call (which lands here too, since both go
  // through the same snapshot field); when a scroll IS needed, "center"
  // (rather than "auto"'s minimal nearest-edge scroll) lands the row well
  // inside the viewport instead of right at its edge, where a rounding/
  // measurement hair can clip it.
  useEffect(() => {
    const el = scrollRef.current;
    if (snapshot.selectedIndex === null || !el) return;
    const itemStart = headerHeight + snapshot.selectedIndex * ROW_HEIGHT;
    const itemEnd = itemStart + ROW_HEIGHT;
    const viewStart = el.scrollTop + headerHeight;
    const viewEnd = el.scrollTop + el.clientHeight;
    const fullyVisible = itemStart >= viewStart && itemEnd <= viewEnd;
    if (!fullyVisible) {
      virtualizer.scrollToIndex(snapshot.selectedIndex, { align: "center" });
    }
  }, [snapshot.selectedIndex, headerHeight]);

  // Up/down arrows move the selection instead of scrolling the table --
  // but only once a row is already selected; with nothing selected there's
  // no "next row" to move to, so the keys fall through to the browser's
  // normal scroll behavior. Skipped while typing in a form field (e.g.
  // FilterBar's where_expr box) so arrow keys there keep their usual
  // text-editing/history meaning instead of jumping the table selection.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (snapshot.selectedIndex === null) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const next = snapshot.selectedIndex + (e.key === "ArrowDown" ? 1 : -1);
      if (next < 0 || next >= snapshot.totalCount) return;
      e.preventDefault();
      store.select(next);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store, snapshot.selectedIndex, snapshot.totalCount]);

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
  // The last column is a minmax track, not a fixed px one, so it absorbs
  // whatever space is left over between the columns and the scrollbar
  // instead of leaving it blank -- everyone else stays a fixed px track
  // (unaffected, still independently resizable). `rowWidth` then has to
  // stop being a bare pixel number: "at least 100% of the wrapper, or the
  // fixed column total, whichever is bigger" is what lets the grid actually
  // have that extra space to give the last track in the first place (a grid
  // narrower than its own column sum has nothing to distribute), while
  // still overflowing (triggering horizontal scroll) once resized columns
  // genuinely don't fit -- CSS max() picks whichever operand is larger, no
  // ResizeObserver/measurement needed to know the wrapper's own width.
  const gridColumns = colWidths.map((w, i) => (i === colWidths.length - 1 ? `minmax(${w}px, 1fr)` : `${w}px`)).join(" ");
  const gridStyle = { "--grid-columns": gridColumns } as CSSProperties;
  const rowWidth = `max(100%, ${totalWidth}px)`;

  function startResize(e: ReactPointerEvent<HTMLDivElement>, index: number) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[index];
    let finalWidth = startWidth;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      finalWidth = Math.max(MIN_COLUMN_WIDTH, startWidth + (ev.clientX - startX));
      setColWidths((prev) => (prev[index] === finalWidth ? prev : prev.map((w, i) => (i === index ? finalWidth : w))));
    }
    function onUp(ev: PointerEvent) {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      // Persist on drag end, not per onMove frame, mirroring gramps-web's
      // immediate-but-not-per-frame settings writes.
      const widths = colWidths.map((w, i) => (i === index ? finalWidth : w));
      saveColumnWidths(
        view.key,
        Object.fromEntries(columns.map(({ column }, i) => [column.key, widths[i]])),
      );
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  return (
    // A single scrolling element owning both axes (rather than the old
    // split of .tableWrapper for horizontal + a nested .scroll for
    // vertical) -- that split put the vertical scrollbar at the right edge
    // of the *full column width*, which sits well past the visible
    // viewport (and this aside's divider) whenever the columns are wider
    // than the pane, making it unreachable without scrolling right first.
    // One container fixes that: its own right edge is the visible
    // viewport's right edge regardless of horizontal scroll position. The
    // header row stays pinned during vertical scroll via position:sticky
    // (classes.header) rather than living outside the scroll container --
    // it's still a normal in-flow child horizontally, so it tracks the
    // body's column positions during horizontal scroll for free.
    <div className={classes.tableWrapper} ref={scrollRef}>
      <div ref={headerRef} className={`${classes.row} ${classes.header}`} style={{ ...gridStyle, width: rowWidth }}>
        {columns.map(({ column: col }, index) => {
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
              <span>{t(col.label)}</span>
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
      <div style={{ height: virtualizer.getTotalSize(), width: rowWidth, position: "relative" }}>
        {virtualItems.map((item) => {
          const rawRow = rows.get(item.index);
          const rowState = store.getRowState(item.index);
          return (
            <div
              key={item.key}
              className={classes.row}
              data-selected={snapshot.selectedIndices.includes(item.index) || undefined}
              // Shift+click's native browser behavior (extending a text
              // selection across everything between the last click and
              // this one) fires on mousedown, before our own onClick below
              // ever runs -- preventDefault has to happen here, on
              // mousedown, to stop it; doing it in onClick instead is too
              // late, the text selection has already happened by then.
              onMouseDown={(e) => {
                if (e.shiftKey) e.preventDefault();
              }}
              onClick={(e) => {
                if (!rawRow) return;
                if (e.shiftKey) store.selectRange(item.index, MAX_RANGE_SELECT);
                else if (e.ctrlKey || e.metaKey) store.toggleSelect(item.index);
                else store.select(item.index);
              }}
              style={{
                ...gridStyle,
                position: "absolute",
                top: 0,
                left: 0,
                width: rowWidth,
                height: item.size,
                // item.start is in scrollMargin-inclusive (raw scrollTop)
                // coordinates -- see the scrollMargin comment above -- but
                // this sizer div itself already sits header-height below
                // the scroll container's top via normal flow, so it must be
                // subtracted back out here or the header's height would be
                // counted twice.
                transform: `translateY(${item.start - headerHeight}px)`,
              }}
            >
              {rawRow ? (
                columns.map(({ column: col, index }) => (
                  <div
                    key={col.key}
                    className={classes.cell}
                    title={col.toTitle ? col.toTitle(rawRow[index]) : undefined}
                  >
                    {col.toDisplay ? col.toDisplay(rawRow[index]) : rawRow[index] == null ? "" : String(rawRow[index])}
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
  );
}
