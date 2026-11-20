// The app's drag-to-reorder list: the story package's SortableList (a ⋮⋮
// grip at each row's left; mouse, touch and keyboard) with the app's own
// words through t(). One implementation for every ordered list -- a
// record's media, a family's children, a place's enclosing places, the
// editors' Media/Children fields, and the story editor's slides and photos.
// Only the grip starts a drag, so row links and buttons keep their clicks.
import { useState, type ReactNode } from "react";
import { SortableList as PackageSortableList, sortableIds, type SortableStrings } from "@gramps-connect/story/editor";
import { t } from "../i18n/i18n";

export { sortableIds };

/** The list's words in the app's current language. Read on each render,
 * like t(). */
export function sortableStrings(): SortableStrings {
  const at = (english: string) => (n: number) => t(english).replace("{n}", String(n));
  return {
    dragToReorder: t("Drag to reorder"),
    reorderHelp: t("To reorder, press Space, move with the arrow keys, then press Space again to drop or Escape to cancel."),
    reorderPickedUp: at("Picked up item {n}."),
    reorderMovedTo: at("Moved to position {n}."),
    reorderDropped: at("Dropped at position {n}."),
    reorderCancelled: t("Move cancelled."),
  };
}

interface SortableListProps {
  /** One key per row, in display order -- usually the row's target handle. */
  keys: string[];
  /** Called once per drop with display indexes; never with from === to. */
  onMove: (from: number, to: number) => void;
  /** No grips (and no dragging): the user can't edit. A single row never
   * gets a grip either. */
  disabled?: boolean;
  /** Renders row `index`; `grip` goes first in the row (null when the list
   * isn't sortable, so the row lays out exactly as it did without one). */
  renderItem: (index: number, grip: ReactNode) => ReactNode;
  /** Gap between rows: px, or a CSS length such as a Mantine spacing var. */
  gap?: number | string;
}

export function SortableList({ gap = 2, ...props }: SortableListProps) {
  return <PackageSortableList {...props} gap={gap} strings={sortableStrings()} />;
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
