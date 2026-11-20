// A vertical list whose rows are reordered by dragging a grip (⋮⋮) at
// their left -- the one reorder control for every ordered ref list in the
// app (a record's media, a family's children, a place's enclosing places,
// and the editors' own Media/Children fields), replacing per-row ↑/↓/★
// buttons. Built on @dnd-kit so a drag works with a mouse, a finger, and
// the keyboard (focus the grip, Space, ↑/↓, Space), with screen-reader
// announcements, rather than HTML5 drag-and-drop (no touch support).
//
// Only the grip starts a drag: rows are full of links, ✎/− buttons and
// zoomable thumbnails that must keep working as clicks.
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
  type Announcements, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { t } from "../i18n/i18n";

/** Stable per-row ids for `keys` (record handles), unique even when the
 * same handle appears twice in one list (a media_list can repeat an
 * object with different regions): the nth occurrence of a handle gets
 * "#n". Exported for tests. */
export function sortableIds(keys: string[]): string[] {
  const seen = new Map<string, number>();
  return keys.map((k) => {
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return `${k}#${n}`;
  });
}

interface SortableListProps {
  /** One key per row, in display order -- usually the row's target handle. */
  keys: string[];
  /** Called once per drop with display indexes; never with from === to. */
  onMove: (from: number, to: number) => void;
  /** No grips (and no dragging): the user can't edit, a save is in
   * progress, or there's only one row. A single row never gets a grip. */
  disabled?: boolean;
  /** Renders row `index`; `grip` goes first in the row (null when the list
   * isn't sortable, so the row lays out exactly as it did without one). */
  renderItem: (index: number, grip: ReactNode) => ReactNode;
  /** Gap between rows: px, or a CSS length such as a Mantine spacing var. */
  gap?: number | string;
}

export function SortableList({ keys, onMove, disabled, renderItem, gap = 2 }: SortableListProps) {
  const ids = useMemo(() => sortableIds(keys), [keys]);
  const sortable = !disabled && keys.length > 1;
  const sensors = useSensors(
    // A few px of movement before a drag starts, so a tap/click on the grip
    // (e.g. to focus it for the keyboard) doesn't count as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const position = (id: string | number) => ids.indexOf(String(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("Picked up item {n}.").replace("{n}", String(position(active.id))),
    onDragOver: ({ over }) => (over ? t("Moved to position {n}.").replace("{n}", String(position(over.id))) : undefined),
    onDragEnd: ({ over }) => (over ? t("Dropped at position {n}.").replace("{n}", String(position(over.id))) : undefined),
    onDragCancel: () => t("Move cancelled."),
  };

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0 && from !== to) onMove(from, to);
  }

  if (!sortable) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap }}>
        {keys.map((_, i) => <div key={ids[i]}>{renderItem(i, null)}</div>)}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: t("To reorder, press Space, move with the arrow keys, then press Space again to drop or Escape to cancel."),
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div style={{ display: "flex", flexDirection: "column", gap }}>
          {ids.map((id, i) => (
            <SortableRow key={id} id={id}>
              {(grip) => renderItem(i, grip)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, children }: { id: string; children: (grip: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: "relative",
    zIndex: isDragging ? 1 : undefined,
    opacity: isDragging ? 0.85 : undefined,
    background: isDragging ? "var(--mantine-color-body)" : undefined,
    boxShadow: isDragging ? "var(--mantine-shadow-sm)" : undefined,
    borderRadius: 4,
  };
  const grip = (
    <span
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={t("Drag to reorder")}
      title={t("Drag to reorder")}
      style={{
        cursor: isDragging ? "grabbing" : "grab",
        // Without this a touch drag scrolls the page instead.
        touchAction: "none",
        userSelect: "none",
        color: "var(--mantine-color-dimmed)",
        fontSize: 14,
        lineHeight: 1,
        padding: "2px 1px",
        flexShrink: 0,
        borderRadius: 3,
      }}
    >
      ⋮⋮
    </span>
  );
  return <div ref={setNodeRef} style={style}>{children(grip)}</div>;
}

/** Shows a server-backed list in its new order straight after a drop,
 * until the refetch it triggers brings back the saved order -- otherwise
 * the dropped row jumps back to where it came from while the PUT runs.
 * `source` is whatever changes when the server data does (the record's
 * detail object): a new one drops the local order. `revert()` drops it
 * too, for a failed save. */
export function useOptimisticOrder<T>(rows: T[], source: unknown) {
  const [local, setLocal] = useState<{ source: unknown; rows: T[] } | null>(null);
  const shown = local && local.source === source ? local.rows : rows;
  return {
    rows: shown,
    move(from: number, to: number) {
      const next = [...shown];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      setLocal({ source, rows: next });
    },
    revert() {
      setLocal(null);
    },
  };
}
