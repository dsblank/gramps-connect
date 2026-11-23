// A tag's "Order priority" as a position in the list of all tags, the way
// Gramps desktop's Organize Tags dialog treats it (gramps/gui/views/tags.py,
// __change_tag_priority): the lowest number wins (the chart colors'
// tagsByPriority), the number means nothing beyond that order, and moving a
// tag renumbers every tag 0, 1, 2, ... in list order, in one transaction.
// Ties and gaps in the stored numbers are fine until then -- they're shown
// in (priority, name) order.
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";
import { apiFetch } from "./apiFetch";
import { commitChangeGroup } from "../pyodidePoc/grampletCommit";
import type { TransactionItem } from "../pyodidePoc/types";

/** A tag record as GET /api/tags/ returns it. */
export type TagRecord = Record<string, unknown> & { handle: string; name?: unknown; priority?: unknown };

/** Set on a tag draft's data once the editor has dragged it somewhere in
 * the list -- otherwise a name/color edit never renumbers anything. Not a
 * Gramps field: saveTagDraft strips it before anything is written. */
export const TAG_MOVED_KEY = "__tagOrderMoved";

export interface TagOrderRow {
  handle: string;
  name: string;
  /** What's stored now (undefined for the tag being created). */
  oldPriority: number | undefined;
  /** What it will be once saved. */
  newPriority: number;
}

export interface TagOrderPlan {
  rows: TagOrderRow[];
  /** Index of the tag being edited/created in `rows`. */
  selfIndex: number;
  /** Some other tag's number changes too, so the save must be one
   * transaction covering them all. */
  renumbersOthers: boolean;
}

function priorityOf(t: TagRecord): number {
  return typeof t.priority === "number" ? t.priority : 0;
}

function nameOf(t: TagRecord): string {
  return typeof t.name === "string" ? t.name : "";
}

/** Gramps' order: lowest number first; ties by name, then handle so the
 * order never depends on how the server happened to list them. */
export function sortTags<T extends TagRecord>(tags: readonly T[]): T[] {
  return [...tags].sort(
    (a, b) =>
      priorityOf(a) - priorityOf(b) ||
      nameOf(a).localeCompare(nameOf(b)) ||
      (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0)
  );
}

/**
 * Where the tag being edited (`self`, its current draft data) sits among
 * `allTags` (every stored tag; `self` itself may be among them), and the
 * number each tag ends up with.
 *
 * - Moved (`self[TAG_MOVED_KEY]`): `self.priority` is the position it was
 *   dropped at; every tag is renumbered 0..n-1 in list order.
 * - Not moved, existing tag: it stays where its stored number puts it and
 *   nothing changes.
 * - Not moved, new tag: it goes last, one past the highest number, so
 *   creating a tag never touches the others.
 */
export function planTagOrder(allTags: readonly TagRecord[], self: TagRecord, original?: TagRecord): TagOrderPlan {
  const others = sortTags(allTags.filter((t) => t.handle !== self.handle));
  const selfName = nameOf(self);
  const toRow = (t: TagRecord): TagOrderRow => ({
    handle: t.handle, name: nameOf(t), oldPriority: priorityOf(t), newPriority: priorityOf(t),
  });

  if (self[TAG_MOVED_KEY]) {
    const at = Math.max(0, Math.min(others.length, Math.trunc(priorityOf(self))));
    const ordered: TagRecord[] = [...others];
    ordered.splice(at, 0, self);
    const rows = ordered.map((t, i) => ({
      handle: t.handle,
      name: t === self ? selfName : nameOf(t),
      oldPriority: t === self ? (original ? priorityOf(original) : undefined) : priorityOf(t),
      newPriority: i,
    }));
    return {
      rows,
      selfIndex: at,
      renumbersOthers: rows.some((r, i) => i !== at && r.oldPriority !== r.newPriority),
    };
  }

  if (original) {
    const stored = { ...original, handle: self.handle };
    const ordered = sortTags([...others, stored]);
    const selfIndex = ordered.indexOf(stored);
    const rows = ordered.map(toRow);
    rows[selfIndex] = { ...rows[selfIndex], name: selfName };
    return { rows, selfIndex, renumbersOthers: false };
  }

  const next = others.length ? Math.max(...others.map(priorityOf)) + 1 : 0;
  return {
    rows: [...others.map(toRow), { handle: self.handle, name: selfName, oldPriority: undefined, newPriority: next }],
    selfIndex: others.length,
    renumbersOthers: false,
  };
}

/** The draft data with the dialog-only marker removed. */
export function withoutMoveMarker(data: Record<string, unknown>): Record<string, unknown> {
  if (!(TAG_MOVED_KEY in data)) return data;
  const { [TAG_MOVED_KEY]: _moved, ...rest } = data;
  return rest;
}

/** Every tag, full records (GET /api/tags/ isn't paged). */
export async function fetchTagRecords(token: string): Promise<TagRecord[]> {
  const res = await apiFetch(`${API_BASE}/api/tags/`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return (await res.json()) as TagRecord[];
}

/**
 * Prepares a tag draft for saving. Returns the data to save the ordinary
 * way (POST/PUT, with `priority` filled in) when only this tag's own number
 * is affected. When the move renumbers other tags, returns null after
 * saving this tag and every renumbered one as one transaction ("Reorder
 * tags"), so one Undo puts the old order back. The server refuses that
 * transaction if any of those tags changed since it was read here.
 */
export async function saveTagDraft(
  token: string,
  draft: { mode: "new" | "edit"; handle: string; data: Record<string, unknown>; originalData?: Record<string, unknown> }
): Promise<Record<string, unknown> | null> {
  const moved = Boolean(draft.data[TAG_MOVED_KEY]);
  const data = withoutMoveMarker(draft.data);
  if (!moved && draft.mode === "edit") return data;

  const all = await fetchTagRecords(token);
  const original = draft.mode === "edit" ? (draft.originalData as TagRecord | undefined) : undefined;
  const plan = planTagOrder(all, { ...draft.data, handle: draft.handle }, original);
  const selfPriority = plan.rows[plan.selfIndex].newPriority;
  if (!plan.renumbersOthers) return { ...data, priority: selfPriority };

  const byHandle = new Map(all.map((t) => [t.handle, t]));
  const items: TransactionItem[] = [];
  for (const row of plan.rows) {
    if (row.handle === draft.handle) {
      const next = { ...data, _class: "Tag", handle: draft.handle, priority: selfPriority };
      items.push(
        draft.mode === "new"
          ? { type: "add", _class: "Tag", handle: draft.handle, old: null, new: next }
          : { type: "update", _class: "Tag", handle: draft.handle, old: { ...draft.originalData, _class: "Tag" }, new: next }
      );
    } else if (row.oldPriority !== row.newPriority) {
      const stored = byHandle.get(row.handle)!;
      items.push({
        type: "update", _class: "Tag", handle: row.handle,
        old: { ...stored, _class: "Tag" },
        new: { ...stored, _class: "Tag", priority: row.newPriority },
      });
    }
  }
  try {
    await commitChangeGroup("Reorder tags", items);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Couldn't save the new tag order: ${message}`);
  }
  return null;
}

/** `handles` (a record's tag_list) in the order its tags win: priority,
 * then name, as sortTags. Handles not in `tags` (a tag created in this
 * dialog and not saved yet) go last, in their own order -- that's where a
 * new tag lands when saved. The stored list itself is never reordered:
 * neither Gramps nor this app gives its order any meaning. */
export function orderTagHandles(handles: readonly string[], tags: ReadonlyMap<string, TagRecord>): string[] {
  const known = sortTags(handles.flatMap((h) => {
    const tag = tags.get(h);
    return tag ? [{ ...tag, handle: h }] : [];
  })).map((t) => t.handle);
  return [...known, ...handles.filter((h) => !tags.has(h))];
}
