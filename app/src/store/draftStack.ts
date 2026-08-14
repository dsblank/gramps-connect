// State for the stacked create/edit dialog flow -- see the plan this
// implements (eager-booping-galaxy.md): any number of open Person/Family
// drafts, each either a not-yet-saved new object or an in-progress edit of
// an existing one, editable as separate floating dialogs (EditDialogs.tsx).
// A save of only-new drafts goes through one atomic POST /api/objects/
// (objectsApi.ts); an edit draft is a single PUT of the whole object,
// preceded by any small "extra objects" it needs first (currently just a
// Person's birth/death Event -- see DraftEntry.extraCreate/extraUpdate).
//
// Plain React state + a co-located hook, not a class+subscribe()/
// getSnapshot() store like viewStore.ts -- that pattern is reserved in this
// codebase for expensive, externally-synced caches (view tables, auth
// session). This is transient UI state local to whoever has an edit dialog
// open, same as every existing dialog's useState (see MenuBar.tsx).
import { useState } from "react";
import { getToken } from "../auth/auth";
import { getViewStore } from "./registry";
import { createHandle, createObjects, fetchPlainObject, updateObject } from "./objectsApi";
import {
  CITATION_VIEW, EVENT_VIEW, FAMILY_VIEW, NOTE_VIEW, PERSON_VIEW, PLACE_VIEW, REPOSITORY_VIEW, SOURCE_VIEW,
  TAG_VIEW, type ViewConfig,
} from "./views";

export type DraftType =
  | "person" | "family" | "event" | "place" | "repository" | "source" | "citation" | "note" | "tag";

/** Every type with a create/edit dialog -- MenuBar's "Add" menu and
 * EditButton's eligibility check both derive from this instead of each
 * hand-listing the same set, so a future type is one line here. Excludes
 * Media (wraps an uploaded file -- path/checksum are server-derived from
 * the binary upload, not fields a blank form fills in; see jobsApi.ts's
 * uploadMedia / ImportMediaDialog for that flow) and the two synthetic
 * views, "generated"/"messages" (Media/Note under a fixed tag filter, not
 * distinct object types). */
export const EDITABLE_TYPES: DraftType[] = [
  "person", "family", "event", "place", "repository", "source", "citation", "note", "tag",
];

/** Singular display name per type, for dialog titles ("New Event"/"Edit
 * Event") and MenuBar's "Add" entries ("New Event…"). */
export const DRAFT_TYPE_LABELS: Record<DraftType, string> = {
  person: "Person", family: "Family", event: "Event", place: "Place", repository: "Repository", source: "Source",
  citation: "Citation", note: "Note", tag: "Tag",
};

const VIEW_BY_TYPE: Record<DraftType, ViewConfig> = {
  person: PERSON_VIEW,
  family: FAMILY_VIEW,
  event: EVENT_VIEW,
  place: PLACE_VIEW,
  repository: REPOSITORY_VIEW,
  source: SOURCE_VIEW,
  citation: CITATION_VIEW,
  note: NOTE_VIEW,
  tag: TAG_VIEW,
};

export interface DraftEntry {
  /** For a "new" draft, client-generated up front (createHandle()) -- this
   * *is* the object's eventual Gramps handle, chosen before it exists on
   * the server, so another draft can reference it (e.g. a Family's
   * father_handle) before either is saved. For an "edit" draft, the real
   * handle of the object being edited. Either way, no separate temp-id/
   * real-id resolution step. */
  handle: string;
  type: DraftType;
  /** "new": save creates it (POST /api/objects/). "edit": save PUTs the
   * whole object back. Mixed create+edit (an edit draft spawning a nested
   * "+ New Person") is deferred -- see the plan -- so an "edit" draft never
   * has `openedFrom` and never appears in another draft's extraCreate. */
  mode: "new" | "edit";
  /** "loading" only while an edit draft's initial GET is in flight;
   * "error" if that GET failed (loadError carries the message) -- either
   * way the dialog withholds its form/Save button until "ready". A "new"
   * draft is "ready" immediately (its default data is synchronous). */
  status: "loading" | "ready" | "error";
  loadError?: string;
  /** Partial (new) or full (edit) Gramps object dict, in the shape the
   * relevant endpoint expects. */
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
  /** Extra objects this draft's save must also create/update first --
   * currently only used by PersonEditDialog for a birth/death Event, kept
   * generic (not Person-specific) so a future field with the same "linked
   * object" shape doesn't need new draftStack plumbing. Populated via
   * setExtraObjects(); untouched by openDraft/openEditDraft. */
  extraCreate: Record<string, unknown>[];
  extraUpdate: { type: DraftType; handle: string; data: Record<string, unknown> }[];
}

// Gramps' own class name per type -- gramps-web-api fills in the rest of
// that class's defaults (complete_gramps_object_dict) for any key a draft
// doesn't set, so a bare `{ _class, handle }` is a valid create payload for
// every type that has no field a blank record can't sensibly start without.
const CLASS_NAME: Record<DraftType, string> = {
  person: "Person", family: "Family", event: "Event", place: "Place", repository: "Repository", source: "Source",
  citation: "Citation", note: "Note", tag: "Tag",
};

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
  if (type === "family") {
    return { _class: "Family", handle, type: "Married" };
  }
  return { _class: CLASS_NAME[type], handle };
}

/** Every draft `handle` depends on (any other draft whose openedFrom points
 * at one of `handle`'s fields) must precede it in the save array -- see
 * objectsApi.ts's doc comment on why. Recurses so nesting deeper than one
 * level (not used by this plan's MVP dialogs, but not precluded by the data
 * model either) still orders correctly. Only ever called with "new" drafts
 * -- an "edit" draft is saved by its own PUT, not folded into this array. */
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
  /** Opens a draft for editing an existing object: fetches its current
   * plain (non-extended) dict and fills the draft in once it lands. Always
   * top-level (no `openedFrom` param) -- mixed create+edit is deferred. */
  openEditDraft: (type: DraftType, handle: string) => void;
  showDraft: (handle: string) => void;
  hideDraft: (handle: string) => void;
  updateDraft: (handle: string, patch: Record<string, unknown>) => void;
  /** Wholesale-replaces a draft's extraCreate/extraUpdate -- see
   * DraftEntry's doc comment. Simplest correct behavior for a field that
   * can go from empty -> filled -> edited -> filled differently. */
  setExtraObjects: (
    handle: string,
    extra: { create: Record<string, unknown>[]; update: DraftEntry["extraUpdate"] }
  ) => void;
  /** Discards a draft and, recursively, every draft opened from it (marks
   * them inactive and hides them); if it was itself opened from a parent
   * field, clears that field back out. */
  closeDraft: (handle: string) => void;
  /** Saves every *active* draft. "new" drafts go together in one atomic
   * POST /api/objects/, in dependency order; each "edit" draft is its own
   * PUT (preceded by its own extraCreate/extraUpdate), sequentially. Not
   * scoped to whichever dialog's Save button was clicked -- there's only
   * ever one pending save, covering every open draft. */
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
    const entry: DraftEntry = {
      handle, type, mode: "new", status: "ready", data: defaultDataFor(type, handle), openedFrom, active: true,
      extraCreate: [], extraUpdate: [],
    };
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

  function openEditDraft(type: DraftType, handle: string) {
    const entry: DraftEntry = {
      handle, type, mode: "edit", status: "loading", data: {}, active: true, extraCreate: [], extraUpdate: [],
    };
    setStack((prev) => [...prev, entry]);
    setOpenHandles((prev) => [...prev, handle]);

    (async () => {
      try {
        const token = await getToken();
        const data = await fetchPlainObject(token, VIEW_BY_TYPE[type], handle);
        setStack((prev) => prev.map((d) => (d.handle === handle ? { ...d, data, status: "ready" } : d)));
      } catch (err: any) {
        setStack((prev) =>
          prev.map((d) => (d.handle === handle ? { ...d, status: "error", loadError: err.message ?? String(err) } : d))
        );
      }
    })();
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

  function setExtraObjects(
    handle: string,
    extra: { create: Record<string, unknown>[]; update: DraftEntry["extraUpdate"] }
  ) {
    setStack((prev) =>
      prev.map((d) => (d.handle === handle ? { ...d, extraCreate: extra.create, extraUpdate: extra.update } : d))
    );
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
      const active = stack.filter((d) => d.active);
      const newDrafts = orderedForSave(active.filter((d) => d.mode === "new"));
      const editDrafts = active.filter((d) => d.mode === "edit");

      const createBatch = newDrafts.flatMap((d) => [...d.extraCreate, d.data]);
      if (createBatch.length > 0) {
        await createObjects(token, createBatch);
      }

      for (const draft of editDrafts) {
        if (draft.extraCreate.length > 0) {
          await createObjects(token, draft.extraCreate);
        }
        for (const upd of draft.extraUpdate) {
          await updateObject(token, VIEW_BY_TYPE[upd.type], upd.handle, upd.data);
        }
        await updateObject(token, VIEW_BY_TYPE[draft.type], draft.handle, draft.data);
      }

      // Immediate feedback for the author, rather than waiting on
      // historyPoll's next tick (same reasoning as MessageComposer.tsx).
      const touchedTypes = new Set([...newDrafts.map((d) => d.type), ...editDrafts.map((d) => d.type)]);
      const touchedEvents = [...newDrafts, ...editDrafts].some(
        (d) => d.extraCreate.length > 0 || d.extraUpdate.length > 0
      );
      if (touchedEvents) touchedTypes.add("event");
      for (const type of touchedTypes) getViewStore(type).requeryDebounced();
      setStack([]);
      setOpenHandles([]);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  return {
    stack, openHandles, openDraft, openEditDraft, showDraft, hideDraft, updateDraft, setExtraObjects, closeDraft,
    saveAll, saving, error,
  };
}
