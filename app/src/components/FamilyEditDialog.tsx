import { useEffect, useRef, useState } from "react";
import { Alert, Anchor, Button, Collapse, Group, Loader, Modal, Select, Stack, Switch, Text, TextInput } from "@mantine/core";
import { getToken } from "../auth/auth";
import { createHandle } from "../store/objectsApi";
import { AttributeListField, type Attribute } from "./EmbeddedListFields";
import { fetchPage, type QueryItem } from "../store/api";
import { CITATION_VIEW, EVENT_VIEW, MEDIA_VIEW, NOTE_VIEW, PERSON_VIEW, TAG_VIEW } from "../store/views";
import type { ViewConfig } from "../store/views";
import { CHILD_REL_OPTIONS } from "./related/RefEditDialog";
import {
  EventsField, MediaListField, OccupiedRefRow, RefListField, RefSlot, SearchOrCreate, cancelledNewDraftHandles,
  findEditDraft, nestedDraftLabel, newDraftsByHandle, openNewListItemPatch, personLabel, pickerResultLabel,
  type EventRefLite,
} from "./RefPickerField";
import type { DraftEntry, DraftType } from "../store/draftStack";

// FamilyRelType's built-in values (gramps/gen/lib/familyreltype.py) as plain
// English strings -- gramps-web-api's fix_object_dict() turns a `type`
// string back into the full GrampsType struct server-side, same as
// ./gramps-web/'s grampsjs-form-select-type already sends.
const REL_TYPE_OPTIONS = ["Married", "Unmarried", "Civil Union", "Unknown"];

type ParentField = "father_handle" | "mother_handle";

// Synthetic per-child `openedFrom.field` names -- draftStack's openedFrom is
// a single-field mechanism (one parent field -> one nested draft); a *list*
// like child_ref_list needs one synthetic field per entry it's currently
// tracking a nested draft for. Two prefixes, two different needs:
//  - NEW: minted fresh (createHandle()) on every "+ New Person" click, since
//    each new child is its own draft with its own eventual handle -- see
//    handleAddNewChildPerson's own doc comment for the rest of that story.
//  - EDIT: derived deterministically from the child's own (already-real)
//    handle, since editing an existing child always means the same field
//    name for that child every time -- no minting, no bookkeeping to clean
//    up afterward (openEditDraft never writes back to the parent's data the
//    way openDraft does, so there's no stray key left behind on Cancel).
const NEW_CHILD_FIELD_PREFIX = "__newChild_";
const EDIT_CHILD_FIELD_PREFIX = "__editChild_";

// Same synthetic-field mechanism, generalized to Family's own Citations/
// Notes/Tags list fields (Media excluded -- see MediaListField.tsx's own
// doc comment for why Media never has a "new draft" to nest) -- see
// PersonEditDialog.tsx's identical set for Notes/Citations/Tags/
// Associations, the same pattern applied there first.
const CITATION_FIELD_PREFIX = "__citation_";
const CITATION_EDIT_FIELD_PREFIX = "__citation_edit_";
const NOTE_FIELD_PREFIX = "__note_";
const NOTE_EDIT_FIELD_PREFIX = "__note_edit_";
const TAG_FIELD_PREFIX = "__tag_";
const TAG_EDIT_FIELD_PREFIX = "__tag_edit_";
const EVENT_FIELD_PREFIX = "__event_";
const EVENT_EDIT_FIELD_PREFIX = "__event_edit_";

interface ChildRefLite {
  _class: "ChildRef";
  ref: string;
  frel?: string;
  mrel?: string;
}

interface ChildrenFieldProps {
  refs: ChildRefLite[];
  labels: Record<string, string>;
  onAdd: (item: QueryItem, frel: string, mrel: string) => void;
  onRemove: (handle: string) => void;
  /** Active "new"-mode Person drafts opened from this Family's children
   * (see FamilyEditDialog's handleAddNewChildPerson) -- keyed by handle, so
   * a child row whose Person hasn't been saved yet renders from the draft
   * itself instead of a plain label + detach. */
  childDraftsByHandle: Map<string, DraftEntry>;
  /** Active "edit"-mode draft for one existing child, if its own &#9998;
   * Edit has been clicked -- see EDIT_CHILD_FIELD_PREFIX above. */
  findChildEditDraft: (refHandle: string) => DraftEntry | undefined;
  onAddNewPerson: (frel: string, mrel: string) => void;
  onOpenEditChildDraft: (refHandle: string) => void;
  onReopenChildDraft: (handle: string) => void;
  onRemoveChildDraft: (handle: string) => void;
}

/** Family.child_ref_list -- add an existing Person (search) or a brand-new
 * one (nested "New Person" draft, same pattern as the parent slots' own
 * "+ New Person" -- see FamilyEditDialog's handleAddNewChildPerson for how
 * a *list* of these coexists with draftStack's single-field `openedFrom`,
 * which father_handle/mother_handle use directly since they're each just
 * one field). frel/mrel (relationship to father/mother) are set *before*
 * adding -- the two Selects below, defaulting to Gramps' own default
 * ("Birth") -- rather than only afterward via a child row's own "✎ Edit"
 * (RefEditDialog, still there for changing one later, on frel/mrel
 * specifically -- this dialog's own &#9998; opens a nested edit of the
 * child Person itself). Not shown per existing-child row here, same MVP
 * scope as the parent slots not showing every ChildRef field either. */
function ChildrenField({
  refs, labels, onAdd, onRemove, childDraftsByHandle, findChildEditDraft, onAddNewPerson, onOpenEditChildDraft,
  onReopenChildDraft, onRemoveChildDraft,
}: ChildrenFieldProps) {
  const [frel, setFrel] = useState("Birth");
  const [mrel, setMrel] = useState("Birth");
  const pickedHandles = new Set(refs.map((r) => r.ref));

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>Children</Text>
      {refs.length === 0 && <Text size="xs" c="dimmed">No children</Text>}
      {refs.map((ref) => {
        const nestedDraft = childDraftsByHandle.get(ref.ref) ?? findChildEditDraft(ref.ref);
        if (nestedDraft) {
          return (
            <OccupiedRefRow
              key={ref.ref}
              label={nestedDraftLabel(nestedDraft)}
              isNew={nestedDraft.mode === "new"}
              onEdit={() => onReopenChildDraft(nestedDraft.handle)}
              onRemove={() => onRemoveChildDraft(nestedDraft.handle)}
              removeLabel={nestedDraft.mode === "new" ? "Remove" : "Cancel edit"}
            />
          );
        }
        return (
          <OccupiedRefRow
            key={ref.ref}
            label={labels[ref.ref] ?? ref.ref}
            isNew={false}
            onEdit={() => onOpenEditChildDraft(ref.ref)}
            onRemove={() => onRemove(ref.ref)}
            removeLabel="Remove child"
          />
        );
      })}
      <Stack gap={4}>
        <Group gap="xs">
          <Select
            label="Relationship to father"
            data={CHILD_REL_OPTIONS}
            value={frel}
            onChange={(next) => setFrel(next ?? "Birth")}
            allowDeselect={false}
            size="xs"
            w={150}
            comboboxProps={{ withinPortal: true }}
          />
          <Select
            label="Relationship to mother"
            data={CHILD_REL_OPTIONS}
            value={mrel}
            onChange={(next) => setMrel(next ?? "Birth")}
            allowDeselect={false}
            size="xs"
            w={150}
            comboboxProps={{ withinPortal: true }}
          />
        </Group>
        <SearchOrCreate
          view={PERSON_VIEW}
          searchField="gramps_id"
          buildExpr={PERSON_VIEW.simpleSearch?.buildExpr}
          renderLabel={personLabel}
          placeholder={PERSON_VIEW.simpleSearch?.placeholder}
          onPick={(item) => {
            if (!pickedHandles.has(item.handle)) onAdd(item, frel, mrel);
          }}
          onOpenNew={() => onAddNewPerson(frel, mrel)}
          createLabel="Person"
        />
      </Stack>
    </Stack>
  );
}

interface FamilyEditDialogProps {
  draft: DraftEntry;
  opened: boolean;
  stack: DraftEntry[];
  onChange: (patch: Record<string, unknown>) => void;
  /** Spawns a nested "new" draft for any list field -- father/mother/
   * children's own Person drafts, and (since phase 4) Citations/Notes/Tags
   * too, each type passing its own synthetic field name (see
   * NEW_CHILD_FIELD_PREFIX and friends above). Returns the new draft's
   * handle synchronously (openDraft's own return value). Same shape as
   * ObjectEditDialog.tsx/PersonEditDialog.tsx's own `onOpenDraft`. */
  onOpenDraft: (type: DraftType, field: string) => string;
  /** Spawns a nested "edit" draft for an already-picked list entry. */
  onOpenEditDraft: (type: DraftType, handle: string, field: string) => void;
  onShowDraft: (handle: string) => void;
  onCloseDraft: (handle: string) => void;
  onCancel: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  saving: boolean;
  error: string | null;
}

/** The "New Family"/"Edit Family" dialog, depending on `draft.mode` --
 * quick fields (father, mother, relationship type) plus a "> Details"
 * disclosure (currently just privacy). Each parent slot can point at an
 * existing Person (picked via search) or spawn its own "New Person" dialog
 * in the stack (draftStack.ts's openDraft with openedFrom), whether this
 * Family draft itself is "new" or "edit" -- see the plan's Save flow for
 * why Cancel here cascades to any such child drafts but Done on a child
 * draft doesn't. Mixing an "edit" Family with a nested "new" Person works
 * because saveAll() always POSTs every active "new" draft (in dependency
 * order) before it PUTs any "edit" draft, so the new parent/child already
 * exists by the time the Family's own PUT references its handle. An
 * already-picked parent or child is equally editable, via the same
 * `openEditDraft` mechanism Place already proved out for Event's own
 * reference field (ObjectEditDialog.tsx) -- see RefPickerField.tsx's
 * RefSlot/OccupiedRefRow for the shared rendering both this dialog and
 * that one now use. Children get the same "+ New Person" option
 * (handleAddNewChildPerson below), wired differently: draftStack's
 * openedFrom only ever writes *one* field (`{[field]: handle}`), which is
 * exactly what father_handle/mother_handle need and exactly not what a
 * *list* like child_ref_list needs. Each "+ New Person" click here mints
 * its own one-off synthetic field name (NEW_CHILD_FIELD_PREFIX + a random
 * suffix) purely so openDraft has something to write to and
 * orderedForSave/closeDraft have a handle->parent link to follow -- the
 * synthetic field's *value* is never read; the real bookkeeping is the
 * ChildRef this appends to child_ref_list immediately (using the handle
 * openDraft already returns synchronously) and the cleanup effect below,
 * which prunes that ChildRef back out if the nested Person draft is later
 * cancelled. Since phase 4, Family also carries Citations/Notes/Media/Tags
 * fields the same way (RefListField/MediaListField, RefPickerField.tsx) --
 * `onOpenDraft`/`onOpenEditDraft` are generic (type is always "person" for
 * father/mother/children, but "citation"/"note"/"tag" for those). */
export function FamilyEditDialog({
  draft, opened, stack, onChange, onOpenDraft, onOpenEditDraft, onShowDraft, onCloseDraft, onCancel,
  primaryLabel, onPrimary, saving, error,
}: FamilyEditDialogProps) {
  const [pickedLabels, setPickedLabels] = useState<Record<string, string>>({});
  const [showDetails, setShowDetails] = useState(false);

  // This dialog stays mounted (same `key={draft.handle}`) across a Cancel
  // and a later re-Edit of the *same* Family -- draftStack.ts's
  // openEditDraft bumps `session` when that happens, rather than mounting a
  // fresh component -- so a "Details" disclosure left open from a cancelled
  // session would otherwise still show expanded next time. See
  // PersonEditDialog's identical session-reset effect for the fuller story.
  const sessionRef = useRef(draft.session);
  useEffect(() => {
    if (draft.session === sessionRef.current) return;
    sessionRef.current = draft.session;
    setShowDetails(false);
    setPickedLabels({});
  }, [draft.session]);

  const childRefs = ((draft.data.child_ref_list as ChildRefLite[] | undefined) ?? []);
  const citationRefs = (draft.data.citation_list as string[] | undefined) ?? [];
  const noteRefs = (draft.data.note_list as string[] | undefined) ?? [];
  const tagRefs = (draft.data.tag_list as string[] | undefined) ?? [];
  const mediaRefsRaw = (draft.data.media_list as { _class: "MediaRef"; ref: string }[] | undefined) ?? [];
  const mediaRefs = mediaRefsRaw.map((r) => r.ref);
  const eventRefs = (draft.data.event_ref_list as EventRefLite[] | undefined) ?? [];

  // A freshly-opened edit draft's father_handle/mother_handle/child_ref_list
  // (and, since phase 4, citation_list/note_list/media_list/tag_list) come
  // straight off the server GET -- pickedLabels (only ever populated by an
  // in-session search pick) has no entry for any of them yet, which
  // without this effect left RefSlot showing "Select existing..." for an
  // *already set* parent (falls through to the no-handle branch below, since
  // that branch keys on pickedLabel being present, not on `handle` alone) --
  // indistinguishable from an actually-empty slot, and one edit away from
  // silently overwriting the wrong parent -- and left every existing
  // reference showing its bare handle instead of a name. Fetches a label
  // for whichever of these isn't already known, once, from whichever view
  // each list's handles actually belong to.
  useEffect(() => {
    if (draft.mode !== "edit" || draft.status !== "ready") return;
    const childHandles = childRefs.map((r) => r.ref);
    // Nested "+ New X" drafts point at a handle that only exists
    // client-side until saveAll() -- fetching a label for one would just
    // waste a request (every field here already renders those from the
    // draft itself, never from pickedLabels).
    const draftHandles = new Set(
      stack.filter((d) => d.active && d.openedFrom?.handle === draft.handle).map((d) => d.handle)
    );
    const pending: { handle: string; view: ViewConfig; type: string }[] = [];
    function collect(handles: string[], view: ViewConfig, type: string) {
      for (const h of handles) {
        if (h && !(h in pickedLabels) && !draftHandles.has(h)) pending.push({ handle: h, view, type });
      }
    }
    collect([draft.data.father_handle, draft.data.mother_handle].filter((h): h is string => typeof h === "string"), PERSON_VIEW, "person");
    collect(childHandles, PERSON_VIEW, "person");
    collect(citationRefs, CITATION_VIEW, "citation");
    collect(noteRefs, NOTE_VIEW, "note");
    collect(mediaRefs, MEDIA_VIEW, "media");
    collect(tagRefs, TAG_VIEW, "tag");
    collect(eventRefs.map((r) => r.ref), EVENT_VIEW, "event");
    if (pending.length === 0) return;
    (async () => {
      const token = await getToken();
      for (const { handle, view, type } of pending) {
        const { page } = await fetchPage(view, token, null, false, `handle == "${handle}"`);
        const item = page.items[0];
        if (!item) continue;
        const label = type === "person" ? personLabel(item) : pickerResultLabel(type, item);
        setPickedLabels((prev) => ({ ...prev, [handle]: label }));
      }
    })();
    // pickedLabels deliberately excluded -- see the comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draft.mode, draft.status, draft.handle, draft.data.father_handle, draft.data.mother_handle,
    draft.data.child_ref_list, draft.data.citation_list, draft.data.note_list, draft.data.media_list,
    draft.data.tag_list, draft.data.event_ref_list, stack,
  ]);

  // Two related bits of cleanup for every "+ New X" list field's synthetic-
  // field mechanism (handleAddNewChildPerson's own doc comment explains the
  // child_ref_list case in full; Citations/Notes/Tags work the same way):
  //  1. Prunes a list once one of its pending items' own nested draft gets
  //     cancelled (its own dialog's Cancel, or this dialog's remove
  //     control -- both funnel through draftStack's closeDraft, which just
  //     marks the draft inactive; this is what turns that into "the entry
  //     pointing at it disappears too"). Scoped to mode === "new"
  //     cancellations only -- cancelling an *edit* of an existing entry
  //     leaves the list untouched, since openEditDraft never wrote
  //     anything into it in the first place.
  //  2. Strips any stray "__newChild_.../__citation_.../..." key back out
  //     of this Family draft's own data: each "+ New X" handler already
  //     neutralizes the one openDraft just wrote (to `undefined`, dropped
  //     by JSON.stringify), but closeDraft's own cascade writes `null`
  //     there on cancellation -- JSON.stringify does *not* drop `null` --
  //     so without this, a cancelled entry would leave a meaningless key in
  //     whatever gets sent to the server.
  // Both guarded so this settles after one run rather than looping: once
  // there's nothing left to prune or strip, the effect is a no-op on every
  // subsequent render.
  useEffect(() => {
    const familyData = draft.data as Record<string, unknown>;
    const newFieldPrefixes = [
      NEW_CHILD_FIELD_PREFIX, CITATION_FIELD_PREFIX, NOTE_FIELD_PREFIX, TAG_FIELD_PREFIX, EVENT_FIELD_PREFIX,
    ];
    const strayFields = Object.keys(familyData).filter(
      (k) => newFieldPrefixes.some((p) => k.startsWith(p)) && familyData[k] !== undefined
    );
    const patch: Record<string, unknown> = {};
    for (const field of strayFields) patch[field] = undefined;
    let changed = strayFields.length > 0;

    const childCancelled = cancelledNewDraftHandles(stack, draft.handle, "person", NEW_CHILD_FIELD_PREFIX);
    if (childCancelled.length > 0 && childRefs.some((r) => childCancelled.includes(r.ref))) {
      patch.child_ref_list = childRefs.filter((r) => !childCancelled.includes(r.ref));
      changed = true;
    }
    const citationCancelled = cancelledNewDraftHandles(stack, draft.handle, "citation", CITATION_FIELD_PREFIX);
    if (citationCancelled.length > 0 && citationRefs.some((h) => citationCancelled.includes(h))) {
      patch.citation_list = citationRefs.filter((h) => !citationCancelled.includes(h));
      changed = true;
    }
    const noteCancelled = cancelledNewDraftHandles(stack, draft.handle, "note", NOTE_FIELD_PREFIX);
    if (noteCancelled.length > 0 && noteRefs.some((h) => noteCancelled.includes(h))) {
      patch.note_list = noteRefs.filter((h) => !noteCancelled.includes(h));
      changed = true;
    }
    const tagCancelled = cancelledNewDraftHandles(stack, draft.handle, "tag", TAG_FIELD_PREFIX);
    if (tagCancelled.length > 0 && tagRefs.some((h) => tagCancelled.includes(h))) {
      patch.tag_list = tagRefs.filter((h) => !tagCancelled.includes(h));
      changed = true;
    }
    const eventCancelled = cancelledNewDraftHandles(stack, draft.handle, "event", EVENT_FIELD_PREFIX);
    if (eventCancelled.length > 0 && eventRefs.some((r) => eventCancelled.includes(r.ref))) {
      patch.event_ref_list = eventRefs.filter((r) => !eventCancelled.includes(r.ref));
      changed = true;
    }

    if (changed) onChange(patch);
  }, [stack, draft.handle, draft.data, onChange]);

  // Covers both "new" and "edit" nested drafts for father_handle/
  // mother_handle -- no mode filter needed since a field only ever has one
  // active nested draft at a time (an existing pick shows "+New Person"
  // when empty, or "✎ Edit" when set; never both at once).
  function findNestedDraft(field: ParentField): DraftEntry | undefined {
    return stack.find((d) => d.active && d.openedFrom?.handle === draft.handle && d.openedFrom.field === field);
  }

  // Active new-person drafts opened from one of *this* Family's children
  // (as opposed to its father/mother slots), keyed by handle -- what
  // ChildrenField uses to tell a not-yet-saved child apart from an
  // existing one it just needs a label for.
  const childDraftsByHandle = new Map(
    stack
      .filter(
        (d) =>
          d.type === "person" && d.mode === "new" && d.active &&
          d.openedFrom?.handle === draft.handle && d.openedFrom.field.startsWith(NEW_CHILD_FIELD_PREFIX)
      )
      .map((d) => [d.handle, d] as const)
  );

  function findChildEditDraft(refHandle: string): DraftEntry | undefined {
    return stack.find(
      (d) =>
        d.active && d.mode === "edit" && d.openedFrom?.handle === draft.handle &&
        d.openedFrom.field === `${EDIT_CHILD_FIELD_PREFIX}${refHandle}`
    );
  }

  function handleAddNewChildPerson(frel: string, mrel: string) {
    const field = `${NEW_CHILD_FIELD_PREFIX}${createHandle()}`;
    const handle = onOpenDraft("person", field);
    // openDraft's own effect just wrote {[field]: handle} onto this Family
    // draft's data (its normal single-field behavior) -- undefined here
    // instead of using that value directly (already have `handle`, straight
    // from openDraft's return) because a stray "__newChild_..." key would
    // otherwise ride along in the Family's own create/update payload.
    // JSON.stringify drops undefined-valued keys, so this is enough to keep
    // it out of what actually reaches the server.
    onChange({
      [field]: undefined,
      child_ref_list: [...childRefs, { _class: "ChildRef", ref: handle, frel, mrel }],
    });
  }

  // Shared by Citations/Notes/Tags -- all three are plain handle lists with
  // no per-entry metadata of their own (same reasoning as
  // PersonEditDialog.tsx's identical set of helpers).
  function addExistingToPlainList(listKey: string, currentRefs: string[], item: QueryItem, type: string) {
    setPickedLabels((prev) => ({ ...prev, [item.handle]: pickerResultLabel(type, item) }));
    onChange({ [listKey]: [...currentRefs, item.handle] });
  }
  function removeFromPlainList(listKey: string, currentRefs: string[], handle: string) {
    onChange({ [listKey]: currentRefs.filter((h) => h !== handle) });
  }
  function openEditListItem(type: DraftType, editFieldPrefix: string, refHandle: string) {
    onOpenEditDraft(type, refHandle, `${editFieldPrefix}${refHandle}`);
  }

  function handleMediaAddExisting(item: QueryItem) {
    setPickedLabels((prev) => ({ ...prev, [item.handle]: pickerResultLabel("media", item) }));
    onChange({ media_list: [...mediaRefsRaw, { _class: "MediaRef", ref: item.handle }] });
  }
  function handleMediaAdded(handle: string, label: string) {
    setPickedLabels((prev) => ({ ...prev, [handle]: label }));
    onChange({ media_list: [...mediaRefsRaw, { _class: "MediaRef", ref: handle }] });
  }
  function handleMediaRemove(handle: string) {
    onChange({ media_list: mediaRefsRaw.filter((r) => r.ref !== handle) });
  }

  function handleEventAddExisting(item: QueryItem, role: string) {
    setPickedLabels((prev) => ({ ...prev, [item.handle]: pickerResultLabel("event", item) }));
    onChange({ event_ref_list: [...eventRefs, { _class: "EventRef", ref: item.handle, role }] });
  }
  function handleAddNewEvent(role: string) {
    const field = `${EVENT_FIELD_PREFIX}${createHandle()}`;
    const handle = onOpenDraft("event", field);
    onChange({ [field]: undefined, event_ref_list: [...eventRefs, { _class: "EventRef", ref: handle, role }] });
  }
  function handleEventRemove(handle: string) {
    onChange({ event_ref_list: eventRefs.filter((r) => r.ref !== handle) });
  }

  const title = draft.mode === "edit" ? "Edit Family" : "New Family";

  if (draft.status === "loading") {
    return (
      <Modal opened={opened} onClose={onCancel} title={title} size="lg" stackId={draft.handle}>
        <Group justify="center" py="md">
          <Loader size="sm" />
        </Group>
      </Modal>
    );
  }
  if (draft.status === "error") {
    return (
      <Modal opened={opened} onClose={onCancel} title={title} size="lg" stackId={draft.handle}>
        <Stack gap="md">
          <Alert color="red" title="Could not load">{draft.loadError}</Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={onCancel}>Close</Button>
          </Group>
        </Stack>
      </Modal>
    );
  }

  function slotProps(field: ParentField, label: string) {
    const handle = (draft.data[field] as string | null) ?? null;
    const nestedDraft = findNestedDraft(field);
    return {
      label,
      handle,
      pickedLabel: handle ? (pickedLabels[handle] ?? null) : null,
      nestedDraft,
      onReopenNested: () => nestedDraft && onShowDraft(nestedDraft.handle),
      onCancelNested: () => nestedDraft && onCloseDraft(nestedDraft.handle),
      onOpenNew: () => onOpenDraft("person", field),
      onOpenEdit: handle ? () => onOpenEditDraft("person", handle, field) : undefined,
      onPick: (item: QueryItem) => {
        setPickedLabels((prev) => ({ ...prev, [item.handle]: personLabel(item) }));
        onChange({ [field]: item.handle });
      },
      onRemovePicked: () => onChange({ [field]: null }),
      createLabel: "Person",
      view: PERSON_VIEW,
      searchField: "gramps_id",
      buildExpr: PERSON_VIEW.simpleSearch?.buildExpr,
      renderLabel: personLabel,
      placeholder: PERSON_VIEW.simpleSearch?.placeholder,
    };
  }

  return (
    <Modal opened={opened} onClose={onCancel} title={title} size="lg" stackId={draft.handle}>
      <Stack gap="lg">
        <TextInput
          label="Gramps ID"
          placeholder="auto-assigned"
          value={(draft.data.gramps_id as string | undefined) ?? ""}
          onChange={(e) => onChange({ gramps_id: e.currentTarget.value })}
        />
        <RefSlot {...slotProps("father_handle", "Father")} />
        <RefSlot {...slotProps("mother_handle", "Mother")} />

        <ChildrenField
          refs={childRefs}
          labels={pickedLabels}
          onAdd={(item, frel, mrel) => {
            setPickedLabels((prev) => ({ ...prev, [item.handle]: personLabel(item) }));
            onChange({
              child_ref_list: [...childRefs, { _class: "ChildRef", ref: item.handle, frel, mrel }],
            });
          }}
          onRemove={(handle) => onChange({ child_ref_list: childRefs.filter((r) => r.ref !== handle) })}
          childDraftsByHandle={childDraftsByHandle}
          findChildEditDraft={findChildEditDraft}
          onAddNewPerson={handleAddNewChildPerson}
          onOpenEditChildDraft={(refHandle) =>
            onOpenEditDraft("person", refHandle, `${EDIT_CHILD_FIELD_PREFIX}${refHandle}`)
          }
          onReopenChildDraft={onShowDraft}
          onRemoveChildDraft={onCloseDraft}
        />

        <Select
          label="Relationship type"
          data={REL_TYPE_OPTIONS}
          value={(draft.data.type as string) ?? "Married"}
          onChange={(next) => onChange({ type: next ?? "Married" })}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />

        <Anchor component="button" type="button" size="sm" onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? "▾" : "▸"} Details
        </Anchor>
        <Collapse in={showDetails}>
          <Stack gap="md">
            <Switch
              label="Private"
              checked={Boolean(draft.data.private)}
              onChange={(e) => onChange({ private: e.currentTarget.checked })}
            />
            <AttributeListField
              items={(draft.data.attribute_list as Attribute[] | undefined) ?? []}
              onChange={(items) => onChange({ attribute_list: items })}
            />

            <RefListField
              label="Citations"
              refs={citationRefs}
              labels={pickedLabels}
              newDraftsByHandle={newDraftsByHandle(stack, draft.handle, "citation", CITATION_FIELD_PREFIX)}
              findEditDraft={(h) => findEditDraft(stack, draft.handle, CITATION_EDIT_FIELD_PREFIX, h)}
              onAddExisting={(item) => addExistingToPlainList("citation_list", citationRefs, item, "citation")}
              onAddNew={() =>
                onChange(openNewListItemPatch(onOpenDraft, "citation", CITATION_FIELD_PREFIX, "citation_list", citationRefs))
              }
              onRemoveExisting={(h) => removeFromPlainList("citation_list", citationRefs, h)}
              onOpenEditDraft={(h) => openEditListItem("citation", CITATION_EDIT_FIELD_PREFIX, h)}
              onReopenDraft={onShowDraft}
              onCancelDraft={onCloseDraft}
              view={CITATION_VIEW}
              searchField="gramps_id"
              buildExpr={CITATION_VIEW.simpleSearch?.buildExpr}
              renderLabel={(item) => pickerResultLabel("citation", item)}
              placeholder={CITATION_VIEW.simpleSearch?.placeholder}
              createLabel="Citation"
            />

            <RefListField
              label="Notes"
              refs={noteRefs}
              labels={pickedLabels}
              newDraftsByHandle={newDraftsByHandle(stack, draft.handle, "note", NOTE_FIELD_PREFIX)}
              findEditDraft={(h) => findEditDraft(stack, draft.handle, NOTE_EDIT_FIELD_PREFIX, h)}
              onAddExisting={(item) => addExistingToPlainList("note_list", noteRefs, item, "note")}
              onAddNew={() => onChange(openNewListItemPatch(onOpenDraft, "note", NOTE_FIELD_PREFIX, "note_list", noteRefs))}
              onRemoveExisting={(h) => removeFromPlainList("note_list", noteRefs, h)}
              onOpenEditDraft={(h) => openEditListItem("note", NOTE_EDIT_FIELD_PREFIX, h)}
              onReopenDraft={onShowDraft}
              onCancelDraft={onCloseDraft}
              view={NOTE_VIEW}
              searchField="gramps_id"
              buildExpr={NOTE_VIEW.simpleSearch?.buildExpr}
              renderLabel={(item) => pickerResultLabel("note", item)}
              placeholder={NOTE_VIEW.simpleSearch?.placeholder}
              createLabel="Note"
            />

            <MediaListField
              label="Media"
              refs={mediaRefs}
              labels={pickedLabels}
              onAddExisting={handleMediaAddExisting}
              onAdded={handleMediaAdded}
              onRemove={handleMediaRemove}
            />

            <RefListField
              label="Tags"
              refs={tagRefs}
              labels={pickedLabels}
              newDraftsByHandle={newDraftsByHandle(stack, draft.handle, "tag", TAG_FIELD_PREFIX)}
              findEditDraft={(h) => findEditDraft(stack, draft.handle, TAG_EDIT_FIELD_PREFIX, h)}
              onAddExisting={(item) => addExistingToPlainList("tag_list", tagRefs, item, "tag")}
              onAddNew={() => onChange(openNewListItemPatch(onOpenDraft, "tag", TAG_FIELD_PREFIX, "tag_list", tagRefs))}
              onRemoveExisting={(h) => removeFromPlainList("tag_list", tagRefs, h)}
              onOpenEditDraft={(h) => openEditListItem("tag", TAG_EDIT_FIELD_PREFIX, h)}
              onReopenDraft={onShowDraft}
              onCancelDraft={onCloseDraft}
              view={TAG_VIEW}
              searchField="name"
              buildExpr={TAG_VIEW.simpleSearch?.buildExpr}
              renderLabel={(item) => pickerResultLabel("tag", item)}
              placeholder={TAG_VIEW.simpleSearch?.placeholder}
              createLabel="Tag"
            />

            <EventsField
              refs={eventRefs}
              labels={pickedLabels}
              newDraftsByHandle={newDraftsByHandle(stack, draft.handle, "event", EVENT_FIELD_PREFIX)}
              findEditDraft={(h) => findEditDraft(stack, draft.handle, EVENT_EDIT_FIELD_PREFIX, h)}
              onAdd={handleEventAddExisting}
              onAddNew={handleAddNewEvent}
              onRemove={handleEventRemove}
              onOpenEditDraft={(h) => openEditListItem("event", EVENT_EDIT_FIELD_PREFIX, h)}
              onReopenDraft={onShowDraft}
              onCancelDraft={onCloseDraft}
            />
          </Stack>
        </Collapse>

        {error && (
          <Alert color="red" title="Could not save">
            {error}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onPrimary} loading={saving}>
            {primaryLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
