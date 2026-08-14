// State for the stacked create-dialog flow -- see the plan this implements
// (eager-booping-galaxy.md): any number of not-yet-saved Person/Family
// objects, editable as separate floating dialogs (EditDialogs.tsx), saved
// together in one atomic POST /api/objects/ (objectsApi.ts) rather than one
// request per dialog.
//
// Plain React state + a co-located hook, not a class+subscribe()/
// getSnapshot() store like viewStore.ts -- that pattern is reserved in this
// codebase for expensive, externally-synced caches (view tables, auth
// session). This is transient UI state local to whoever has an edit dialog
// open, same as every existing dialog's useState (see MenuBar.tsx).
import { useState } from "react";
import { getToken } from "../auth/auth";
import { getViewStore } from "./registry";
import { createHandle, createObjects } from "./objectsApi";

export type DraftType = "person" | "family";

export interface DraftEntry {
  /** Client-generated up front (createHandle()) -- this *is* the object's
   * eventual Gramps handle, chosen before it exists on the server, so
   * another draft can reference it (e.g. a Family's father_handle) before
   * either is saved. No separate temp-id/real-id resolution step. */
  handle: string;
  type: DraftType;
  /** Partial Gramps object dict, in the shape POST /api/objects/ expects. */
  data: Record<string, unknown>;
  /** Set only when this draft was opened from a field on another draft
   * (e.g. a Family's "+ New Person" on Father) -- lets Cancel on this
   * dialog clear that field back out on its parent, and lets saveAll()
   * order the array so this draft precedes the parent that references it. */
  openedFrom?: { handle: string; field: string };
  /** False once Cancelled -- excluded from saveAll(), but the entry stays
   * in `stack` (rather than being removed) for the reason EditDialogs.tsx
   * never stops rendering a discarded draft's Modal either: see this
   * module's doc comment on Mantine's ModalStack for why unmounting a
   * registered Modal is unsafe. */
  active: boolean;
}

function defaultDataFor(type: DraftType, handle: string): Record<string, unknown> {
  if (type === "person") {
    return {
      _class: "Person",
      handle,
      // Person.UNKNOWN (gramps/gen/lib/person.py) -- neither guessed sex
      // nor left to default to Female/Male.
      gender: 2,
      primary_name: {
        _class: "Name",
        first_name: "",
        surname_list: [{ _class: "Surname", surname: "" }],
      },
    };
  }
  return { _class: "Family", handle, type: "Married" };
}

/** Every draft `handle` depends on (any other draft whose openedFrom points
 * at one of `handle`'s fields) must precede it in the save array -- see
 * objectsApi.ts's doc comment on why. Recurses so nesting deeper than one
 * level (not used by this plan's MVP dialogs, but not precluded by the data
 * model either) still orders correctly. */
function orderedForSave(drafts: DraftEntry[]): DraftEntry[] {
  const visited = new Set<string>();
  const ordered: DraftEntry[] = [];
  function visit(entry: DraftEntry) {
    if (visited.has(entry.handle)) return;
    visited.add(entry.handle);
    for (const other of drafts) {
      if (other.openedFrom?.handle === entry.handle) visit(other);
    }
    ordered.push(entry);
  }
  for (const entry of drafts) visit(entry);
  return ordered;
}

export interface UseDraftStack {
  /** Every draft opened this session, active or cancelled -- see
   * DraftEntry.active's doc comment for why a cancelled one stays here
   * rather than being removed. EditDialogs.tsx renders a Modal for each of
   * these unconditionally, keyed by handle, and toggles visibility via
   * `openHandles` instead of mounting/unmounting. */
  stack: DraftEntry[];
  /** Which drafts currently show as an open (vs. hidden) dialog. */
  openHandles: string[];
  openDraft: (type: DraftType, openedFrom?: DraftEntry["openedFrom"]) => string;
  showDraft: (handle: string) => void;
  hideDraft: (handle: string) => void;
  updateDraft: (handle: string, patch: Record<string, unknown>) => void;
  /** Discards a draft and, recursively, every draft opened from it (marks
   * them inactive and hides them); if it was itself opened from a parent
   * field, clears that field back out. */
  closeDraft: (handle: string) => void;
  /** Saves every *active* draft in one POST /api/objects/, in dependency
   * order. Not scoped to whichever dialog's Save button was clicked --
   * there's only ever one pending save, covering every open draft. */
  saveAll: () => Promise<void>;
  saving: boolean;
  error: string | null;
}

export function useDraftStack(): UseDraftStack {
  const [stack, setStack] = useState<DraftEntry[]>([]);
  const [openHandles, setOpenHandles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDraft(type: DraftType, openedFrom?: DraftEntry["openedFrom"]): string {
    const handle = createHandle();
    const entry: DraftEntry = { handle, type, data: defaultDataFor(type, handle), openedFrom, active: true };
    setStack((prev) => {
      const next = [...prev, entry];
      if (!openedFrom) return next;
      return next.map((d) =>
        d.handle === openedFrom.handle ? { ...d, data: { ...d.data, [openedFrom.field]: handle } } : d
      );
    });
    setOpenHandles((prev) => [...prev, handle]);
    return handle;
  }

  function showDraft(handle: string) {
    setOpenHandles((prev) => (prev.includes(handle) ? prev : [...prev, handle]));
  }

  function hideDraft(handle: string) {
    setOpenHandles((prev) => prev.filter((h) => h !== handle));
  }

  function updateDraft(handle: string, patch: Record<string, unknown>) {
    setStack((prev) => prev.map((d) => (d.handle === handle ? { ...d, data: { ...d.data, ...patch } } : d)));
  }

  function closeDraft(handle: string) {
    setStack((prev) => {
      const toDeactivate = new Set<string>();
      function collect(h: string) {
        if (toDeactivate.has(h)) return;
        toDeactivate.add(h);
        for (const d of prev) if (d.openedFrom?.handle === h) collect(d.handle);
      }
      collect(handle);
      const closed = prev.find((d) => d.handle === handle);
      return prev.map((d) => {
        if (toDeactivate.has(d.handle)) return { ...d, active: false };
        if (closed?.openedFrom && d.handle === closed.openedFrom.handle) {
          return { ...d, data: { ...d.data, [closed.openedFrom.field]: null } };
        }
        return d;
      });
    });
    setOpenHandles((prev) => prev.filter((h) => h !== handle));
  }

  async function saveAll() {
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const ordered = orderedForSave(stack.filter((d) => d.active));
      await createObjects(
        token,
        ordered.map((d) => d.data)
      );
      // Immediate feedback for the author, rather than waiting on
      // historyPoll's next tick (same reasoning as MessageComposer.tsx).
      const tables = new Set(ordered.map((d) => d.type));
      if (tables.has("person")) getViewStore("person").requeryDebounced();
      if (tables.has("family")) getViewStore("family").requeryDebounced();
      setStack([]);
      setOpenHandles([]);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return { stack, openHandles, openDraft, showDraft, hideDraft, updateDraft, closeDraft, saveAll, saving, error };
}
