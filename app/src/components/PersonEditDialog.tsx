import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert, Anchor, Button, Collapse, Group, Loader, Modal, Select, Stack, Switch, Text, TextInput,
} from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { getToken } from "../auth/auth";
import { t } from "../i18n/i18n";
import { createHandle, fetchPlainObject } from "../store/objectsApi";
import { fetchPage, type QueryItem } from "../store/api";
import { CITATION_VIEW, EVENT_VIEW, MEDIA_VIEW, NOTE_VIEW, PERSON_VIEW, TAG_VIEW } from "../store/views";
import type { DraftEntry, DraftType } from "../store/draftStack";
import type { ViewConfig } from "../store/views";
import { DateInput } from "./DateInput";
import {
  AttributeListField, AddressListField, UrlListField, type Attribute, type Address, type Url,
} from "./EmbeddedListFields";
import { NameEditDialog } from "./NameEditDialog";
import { EventPlaceField, type EventPlaceValue } from "./EventPlaceField";
import { CircleGlyphButton } from "./CircleGlyphButton";
import {
  EventsField, MediaListField, OccupiedRefRow, RefListField, SearchOrCreate, cancelledNewDraftHandles, findEditDraft,
  nestedDraftLabel, newDraftsByHandle, openNewListItemPatch, personLabel, pickerResultLabel, type EventRefLite,
} from "./RefPickerField";

// Person.{FEMALE,MALE,UNKNOWN,OTHER} (gramps/gen/lib/person.py) -- gender is
// a plain integer on the wire, not a GrampsType struct.
const GENDER_OPTIONS = [
  { value: "2", label: "Unknown" },
  { value: "1", label: "Male" },
  { value: "0", label: "Female" },
  { value: "3", label: "Other" },
];

// Synthetic `openedFrom.field` prefixes for this dialog's own list fields --
// same mechanism (and same reasoning) as FamilyEditDialog.tsx's
// NEW_CHILD_FIELD_PREFIX/EDIT_CHILD_FIELD_PREFIX, generalized across four
// lists instead of one: a "new"-mode field is minted fresh per click
// (RefPickerField.tsx's newDraftsByHandle finds it by scanning for the
// prefix), an "edit"-mode field is derived deterministically from the
// target's own handle (RefPickerField.tsx's findEditDraft looks it up
// directly, no scanning needed). Media has neither -- see MediaListField's
// own doc comment for why a Media object never has a "new draft" to nest.
const NOTE_FIELD_PREFIX = "__note_";
const NOTE_EDIT_FIELD_PREFIX = "__note_edit_";
const CITATION_FIELD_PREFIX = "__citation_";
const CITATION_EDIT_FIELD_PREFIX = "__citation_edit_";
const TAG_FIELD_PREFIX = "__tag_";
const TAG_EDIT_FIELD_PREFIX = "__tag_edit_";
const ASSOC_FIELD_PREFIX = "__assoc_";
const ASSOC_EDIT_FIELD_PREFIX = "__assoc_edit_";
const EVENT_FIELD_PREFIX = "__event_";
const EVENT_EDIT_FIELD_PREFIX = "__event_edit_";

interface PersonRefLite {
  _class: "PersonRef";
  ref: string;
  rel?: string;
}

interface AssociationsFieldProps {
  refs: PersonRefLite[];
  labels: Record<string, string>;
  newDrafts: Map<string, DraftEntry>;
  findEdit: (refHandle: string) => DraftEntry | undefined;
  onAdd: (item: QueryItem, rel: string) => void;
  onAddNew: (rel: string) => void;
  onRemove: (handle: string) => void;
  onOpenEditDraft: (refHandle: string) => void;
  onReopenDraft: (draftHandle: string) => void;
  onCancelDraft: (draftHandle: string) => void;
}

/** Person.person_ref_list -- associations to other people (godparent,
 * witness, ...), each carrying its own free-text `rel` description. Same
 * shape as FamilyEditDialog.tsx's ChildrenField (a list, plus one extra
 * per-entry field set *before* adding, same as frel/mrel there) -- kept as
 * its own small component rather than folded into the generic
 * RefListField, since Notes/Citations/Tags have no such extra field at
 * all. `rel` isn't editable on an already-added association from here, same
 * MVP scope ChildrenField's own frel/mrel already accepted. */
function AssociationsField({
  refs, labels, newDrafts, findEdit, onAdd, onAddNew, onRemove, onOpenEditDraft, onReopenDraft, onCancelDraft,
}: AssociationsFieldProps) {
  const [rel, setRel] = useState("");
  const pickedHandles = new Set(refs.map((r) => r.ref));

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{t("Associations")}</Text>
      {refs.length === 0 && <Text size="xs" c="dimmed">{t("No associations")}</Text>}
      {refs.map((ref) => {
        const nestedDraft = newDrafts.get(ref.ref) ?? findEdit(ref.ref);
        if (nestedDraft) {
          return (
            <OccupiedRefRow
              key={ref.ref}
              label={nestedDraftLabel(nestedDraft)}
              isNew={nestedDraft.mode === "new"}
              onEdit={() => onReopenDraft(nestedDraft.handle)}
              onRemove={() => onCancelDraft(nestedDraft.handle)}
              removeLabel={nestedDraft.mode === "new" ? "Remove" : "Cancel edit"}
            />
          );
        }
        const label = labels[ref.ref] ?? ref.ref;
        return (
          <OccupiedRefRow
            key={ref.ref}
            label={ref.rel ? `${label} — ${ref.rel}` : label}
            isNew={false}
            onEdit={() => onOpenEditDraft(ref.ref)}
            onRemove={() => onRemove(ref.ref)}
            removeLabel="Remove"
          />
        );
      })}
      <Stack gap={4}>
        <TextInput
          label={t("Relationship")}
          placeholder={t("e.g. Godfather")}
          size="xs"
          value={rel}
          onChange={(e) => setRel(e.currentTarget.value)}
        />
        <SearchOrCreate
          view={PERSON_VIEW}
          searchField="gramps_id"
          buildExpr={PERSON_VIEW.simpleSearch?.buildExpr}
          renderLabel={personLabel}
          placeholder={PERSON_VIEW.simpleSearch?.placeholder}
          onPick={(item) => {
            if (!pickedHandles.has(item.handle)) onAdd(item, rel);
          }}
          onOpenNew={() => onAddNew(rel)}
          createLabel="Person"
        />
      </Stack>
    </Stack>
  );
}

interface PersonEditDialogProps {
  draft: DraftEntry;
  /** EditDialogs.tsx renders one of these for every draft ever opened this
   * session, active or not (see draftStack.ts's DraftEntry.active doc
   * comment for why) -- this prop, not mount/unmount, is what actually
   * shows or hides it. */
  opened: boolean;
  /** Every draft opened this session -- needed to find/reopen a list
   * field's own in-progress nested drafts (Citations/Notes/Media/Tags/
   * Associations), same as FamilyEditDialog/ObjectEditDialog already take. */
  stack: DraftEntry[];
  onChange: (patch: Record<string, unknown>) => void;
  onSetExtraObjects: (extra: { create: Record<string, unknown>[]; update: DraftEntry["extraUpdate"] }) => void;
  /** Spawns a nested "new" draft for a list field (openDraft with
   * `openedFrom` set to that field) -- returns the new draft's handle
   * synchronously, same as FamilyEditDialog's onOpenPersonDraft. */
  onOpenDraft: (type: DraftType, field: string) => string;
  /** Spawns a nested "edit" draft for an already-picked list entry. */
  onOpenEditDraft: (type: DraftType, handle: string, field: string) => void;
  onShowDraft: (handle: string) => void;
  onCloseDraft: (handle: string) => void;
  onCancel: () => void;
  /** "Done" (nested -- just hides this dialog, keeps the draft in the
   * pending save) or "Save" (top-level -- actually POSTs/PUTs), decided by
   * EditDialogs.tsx based on whether this draft has an openedFrom. */
  primaryLabel: string;
  onPrimary: () => void;
  saving: boolean;
  error: string | null;
}

type EventRefLike = { _class?: string; ref: string; role?: unknown };

/** A "New Person" or "Edit Person" dialog in the stack, depending on
 * `draft.mode`. Quick fields (name, gender) plus a "> Details" disclosure
 * (name extras, privacy, birth/death date, and -- since phase 3 -- every
 * list this Person carries: Citations, Notes, Media, Tags, Associations,
 * the same "select existing or create new" fields Family's parent/child
 * slots already use, generalized in RefPickerField.tsx) -- see the plan for
 * why birth/death needs its own Event create/update handling below rather
 * than being a flat Person field. Moving these lists in here is what lets
 * RelatedPanel's own Notes/Citations/Media/Tags/Associations sections go
 * back to being pure read-only display for a Person -- see those sections'
 * own `type === "person"` gate. */
export function PersonEditDialog({
  draft, opened, stack, onChange, onSetExtraObjects, onOpenDraft, onOpenEditDraft, onShowDraft, onCloseDraft,
  onCancel, primaryLabel, onPrimary, saving, error,
}: PersonEditDialogProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [birthDate, setBirthDate] = useState<GrampsDate | null>(null);
  const [deathDate, setDeathDate] = useState<GrampsDate | null>(null);
  // The *existing* linked Event, when editing a Person that already has
  // one (fetched below) -- null for a brand-new Person, or one that never
  // had a birth/death event recorded.
  const [birthEvent, setBirthEvent] = useState<{ handle: string; data: Record<string, unknown> } | null>(null);
  const [deathEvent, setDeathEvent] = useState<{ handle: string; data: Record<string, unknown> } | null>(null);
  // A client-generated handle for a birth/death Event that doesn't exist on
  // the server yet, held stable across repeated date edits before Save
  // (rather than minting a fresh one -- and orphaning the last -- on every
  // keystroke).
  const [pendingBirthHandle, setPendingBirthHandle] = useState<string | null>(null);
  const [pendingDeathHandle, setPendingDeathHandle] = useState<string | null>(null);
  const [birthPlace, setBirthPlace] = useState<EventPlaceValue | null>(null);
  const [deathPlace, setDeathPlace] = useState<EventPlaceValue | null>(null);
  const [eventsLoaded, setEventsLoaded] = useState(false);

  const [primaryNameOpen, setPrimaryNameOpen] = useState(false);
  // `altIds` is the live id-per-entry mapping, in lockstep with
  // draft.data.alternate_names (same length/order) -- it shrinks when an
  // alternate name is removed. `everAltIds` only ever grows: it's what
  // decides which NameEditDialog Modals get rendered at all, since a Modal
  // registered with Mantine's ModalStack can never be safely unmounted once
  // rendered (see draftStack.ts's DraftEntry.active doc comment) -- a
  // removed alternate name's dialog stays mounted forever, just permanently
  // closed and orphaned from `altIds`.
  const [altIds, setAltIds] = useState<string[]>([]);
  const [everAltIds, setEverAltIds] = useState<string[]>([]);
  const [openAltIds, setOpenAltIds] = useState<string[]>([]);
  const [altSeeded, setAltSeeded] = useState(false);

  // Display labels for every list field's already-picked entries (handle ->
  // label), shared across Citations/Notes/Media/Tags/Associations -- same
  // pickedLabels pattern FamilyEditDialog/ObjectEditDialog already use for
  // their own reference fields, just one shared map instead of one per
  // field (handles are globally unique, so no risk of collision between
  // e.g. a Citation and a Tag happening to share a key).
  const [pickedLabels, setPickedLabels] = useState<Record<string, string>>({});

  // This dialog stays mounted (same `key={draft.handle}`) across a Cancel
  // and a later re-Edit of the *same* Person -- draftStack.ts's
  // openEditDraft bumps `session` when that happens, rather than mounting a
  // fresh component, so every bit of local UI state below (which otherwise
  // just carries over from the cancelled session -- a stale "Details"
  // disclosure or "More…" name dialog left open, stale birth/death dates,
  // ...) has to be cleared by hand here instead of resetting for free via
  // useState's initial value. `everAltIds` is deliberately NOT cleared: it
  // only ever grows, since a NameEditDialog Modal already registered with
  // Mantine's ModalStack can never be safely unmounted (see this file's own
  // doc comment above).
  const sessionRef = useRef(draft.session);
  useEffect(() => {
    if (draft.session === sessionRef.current) return;
    sessionRef.current = draft.session;
    setShowDetails(false);
    setBirthDate(null);
    setDeathDate(null);
    setBirthEvent(null);
    setDeathEvent(null);
    setPendingBirthHandle(null);
    setPendingDeathHandle(null);
    setBirthPlace(null);
    setDeathPlace(null);
    setEventsLoaded(false);
    setPrimaryNameOpen(false);
    setAltIds([]);
    setOpenAltIds([]);
    setAltSeeded(false);
    setPickedLabels({});
  }, [draft.session]);

  // Closing (Cancel, or Done on a nested draft) this dialog while a "More…"
  // name dialog is open left that nested Modal as the only thing on screen
  // -- its own stackId keeps it registered with Mantine's ModalStack
  // independent of this Modal's `opened`, so it doesn't close on its own
  // just because its opener did. The session-reset effect above only covers
  // a *later* re-Edit; this covers the moment of closing itself.
  useEffect(() => {
    if (opened) return;
    setPrimaryNameOpen(false);
    setOpenAltIds([]);
  }, [opened]);

  // One-time assignment of a local id to each of an edit draft's existing
  // alternate_names, once its GET has resolved -- mirrors eventsLoaded
  // below. A "new" draft starts with an empty alternate_names, so needs no
  // seeding.
  useEffect(() => {
    if (draft.mode !== "edit" || draft.status !== "ready" || altSeeded) return;
    setAltSeeded(true);
    const alt = (draft.data.alternate_names as Record<string, unknown>[] | undefined) ?? [];
    const ids = alt.map(() => createHandle());
    setAltIds(ids);
    setEverAltIds(ids);
  }, [draft.mode, draft.status, altSeeded]);

  // One-time fetch of the existing birth/death Event(s), once an edit
  // draft's own Person GET has resolved. Kept separate from draftStack's
  // openEditDraft (which only knows about the Person object) -- this
  // Person-specific Event-linking logic stays local to this dialog rather
  // than generalized into draftStack.
  useEffect(() => {
    if (draft.mode !== "edit" || draft.status !== "ready" || eventsLoaded) return;
    setEventsLoaded(true);
    const eventRefs = (draft.data.event_ref_list as EventRefLike[] | undefined) ?? [];
    const birthIdx = typeof draft.data.birth_ref_index === "number" ? draft.data.birth_ref_index : -1;
    const deathIdx = typeof draft.data.death_ref_index === "number" ? draft.data.death_ref_index : -1;
    (async () => {
      const token = await getToken();
      if (birthIdx >= 0 && eventRefs[birthIdx]) {
        const data = await fetchPlainObject(token, EVENT_VIEW, eventRefs[birthIdx].ref);
        setBirthEvent({ handle: eventRefs[birthIdx].ref, data });
        setBirthDate((data.date as GrampsDate | undefined) ?? null);
        const placeHandle = data.place as string | undefined;
        if (placeHandle) setBirthPlace({ handle: placeHandle });
      }
      if (deathIdx >= 0 && eventRefs[deathIdx]) {
        const data = await fetchPlainObject(token, EVENT_VIEW, eventRefs[deathIdx].ref);
        setDeathEvent({ handle: eventRefs[deathIdx].ref, data });
        setDeathDate((data.date as GrampsDate | undefined) ?? null);
        const placeHandle = data.place as string | undefined;
        if (placeHandle) setDeathPlace({ handle: placeHandle });
      }
    })();
  }, [draft.mode, draft.status, eventsLoaded]);

  const noteRefs = (draft.data.note_list as string[] | undefined) ?? [];
  const citationRefs = (draft.data.citation_list as string[] | undefined) ?? [];
  const tagRefs = (draft.data.tag_list as string[] | undefined) ?? [];
  const mediaRefsRaw = (draft.data.media_list as { _class: "MediaRef"; ref: string }[] | undefined) ?? [];
  const mediaRefs = mediaRefsRaw.map((r) => r.ref);
  const assocRefs = (draft.data.person_ref_list as PersonRefLite[] | undefined) ?? [];

  // Events are the one list field here that isn't the *whole* underlying
  // list: birth_ref_index/death_ref_index each pin one entry of
  // event_ref_list as "the" birth/death Event, already fully managed above
  // (its own date/place fields, its own extraCreate/extraUpdate) -- showing
  // them again in a generic Events list would just be a confusing second
  // way to edit the same thing. Filtered out here, purely for *display*;
  // the underlying event_ref_list these handlers read and write is always
  // the full one (see withReindexedBirthDeath below for why).
  const fullEventRefs = (draft.data.event_ref_list as EventRefLite[] | undefined) ?? [];
  const birthRefIdx = typeof draft.data.birth_ref_index === "number" ? draft.data.birth_ref_index : -1;
  const deathRefIdx = typeof draft.data.death_ref_index === "number" ? draft.data.death_ref_index : -1;
  const otherEventRefs = fullEventRefs.filter((_, i) => i !== birthRefIdx && i !== deathRefIdx);

  /** Rebuilds birth_ref_index/death_ref_index for a new version of
   * event_ref_list -- needed because those are plain array *indices*, not
   * handles: removing (or inserting before) any other entry in the same
   * array would otherwise silently shift them to point at the wrong Event.
   * Re-finds the birth/death Event by its own handle (already tracked by
   * the birth/death state above, whether saved or still pending) rather
   * than trusting the old index. */
  function withReindexedBirthDeath(newFullList: EventRefLite[]): Record<string, unknown> {
    const birthHandle = birthEvent?.handle ?? pendingBirthHandle;
    const deathHandle = deathEvent?.handle ?? pendingDeathHandle;
    return {
      event_ref_list: newFullList,
      birth_ref_index: birthHandle ? newFullList.findIndex((r) => r.ref === birthHandle) : -1,
      death_ref_index: deathHandle ? newFullList.findIndex((r) => r.ref === deathHandle) : -1,
    };
  }

  // Same fix as FamilyEditDialog.tsx's father/mother seeding effect,
  // generalized across every list field here: an edit draft's already-set
  // Citations/Notes/Media/Tags/Associations come straight off the server
  // GET, with no entry yet in pickedLabels -- fetched here, once, from
  // whichever view each list's handles actually belong to (four different
  // views across five lists, since Associations targets Person same as the
  // other four target their own type).
  useEffect(() => {
    if (draft.mode !== "edit" || draft.status !== "ready") return;
    const draftHandles = new Set(
      stack.filter((d) => d.active && d.openedFrom?.handle === draft.handle).map((d) => d.handle)
    );
    const pending: { handle: string; view: ViewConfig; type: string }[] = [];
    function collect(handles: string[], view: ViewConfig, type: string) {
      for (const h of handles) {
        if (h && !(h in pickedLabels) && !draftHandles.has(h)) pending.push({ handle: h, view, type });
      }
    }
    collect(noteRefs, NOTE_VIEW, "note");
    collect(citationRefs, CITATION_VIEW, "citation");
    collect(tagRefs, TAG_VIEW, "tag");
    collect(mediaRefs, MEDIA_VIEW, "media");
    collect(assocRefs.map((r) => r.ref), PERSON_VIEW, "person");
    collect(otherEventRefs.map((r) => r.ref), EVENT_VIEW, "event");
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
    // pickedLabels deliberately excluded -- see FamilyEditDialog.tsx's
    // identical effect for why.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draft.mode, draft.status, draft.handle, draft.data.note_list, draft.data.citation_list, draft.data.tag_list,
    draft.data.media_list, draft.data.person_ref_list, draft.data.event_ref_list, draft.data.birth_ref_index,
    draft.data.death_ref_index, stack,
  ]);

  // Same two-part cleanup FamilyEditDialog.tsx's own child_ref_list effect
  // does, generalized across every list field with a "new"-mode draft
  // (Citations/Notes/Tags/Associations -- Media never has one, see
  // MediaListField's own doc comment): strips stray synthetic keys a
  // cancelled draft's closeDraft cascade wrote `null` into, and prunes each
  // list of whichever handle(s) that cancelled draft was standing in for.
  useEffect(() => {
    const data = draft.data as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    let changed = false;

    const newFieldPrefixes = [
      NOTE_FIELD_PREFIX, CITATION_FIELD_PREFIX, TAG_FIELD_PREFIX, ASSOC_FIELD_PREFIX, EVENT_FIELD_PREFIX,
    ];
    for (const key of Object.keys(data)) {
      if (newFieldPrefixes.some((p) => key.startsWith(p)) && data[key] !== undefined) {
        patch[key] = undefined;
        changed = true;
      }
    }

    const noteCancelled = cancelledNewDraftHandles(stack, draft.handle, "note", NOTE_FIELD_PREFIX);
    if (noteCancelled.length > 0 && noteRefs.some((h) => noteCancelled.includes(h))) {
      patch.note_list = noteRefs.filter((h) => !noteCancelled.includes(h));
      changed = true;
    }
    const citationCancelled = cancelledNewDraftHandles(stack, draft.handle, "citation", CITATION_FIELD_PREFIX);
    if (citationCancelled.length > 0 && citationRefs.some((h) => citationCancelled.includes(h))) {
      patch.citation_list = citationRefs.filter((h) => !citationCancelled.includes(h));
      changed = true;
    }
    const tagCancelled = cancelledNewDraftHandles(stack, draft.handle, "tag", TAG_FIELD_PREFIX);
    if (tagCancelled.length > 0 && tagRefs.some((h) => tagCancelled.includes(h))) {
      patch.tag_list = tagRefs.filter((h) => !tagCancelled.includes(h));
      changed = true;
    }
    const assocCancelled = cancelledNewDraftHandles(stack, draft.handle, "person", ASSOC_FIELD_PREFIX);
    if (assocCancelled.length > 0 && assocRefs.some((r) => assocCancelled.includes(r.ref))) {
      patch.person_ref_list = assocRefs.filter((r) => !assocCancelled.includes(r.ref));
      changed = true;
    }
    const eventCancelled = cancelledNewDraftHandles(stack, draft.handle, "event", EVENT_FIELD_PREFIX);
    if (eventCancelled.length > 0 && fullEventRefs.some((r) => eventCancelled.includes(r.ref))) {
      Object.assign(patch, withReindexedBirthDeath(fullEventRefs.filter((r) => !eventCancelled.includes(r.ref))));
      changed = true;
    }

    if (changed) onChange(patch);
  }, [stack, draft.handle, draft.data, onChange]);

  // Derives extraCreate/extraUpdate (draftStack.ts) plus, when a brand-new
  // Event needs linking, a patch to the Person's own event_ref_list/
  // birth_ref_index/death_ref_index -- from birth/deathDate, birth/deathPlace,
  // and what's already known about an existing/pending Event, not from
  // draft.data (which this effect itself writes back via onChange --
  // including it in the dependency list would create a feedback loop).
  useEffect(() => {
    const create: Record<string, unknown>[] = [];
    const update: DraftEntry["extraUpdate"] = [];
    let eventRefList = [...((draft.data.event_ref_list as EventRefLike[] | undefined) ?? [])];
    let birthRefIndex = typeof draft.data.birth_ref_index === "number" ? draft.data.birth_ref_index : -1;
    let deathRefIndex = typeof draft.data.death_ref_index === "number" ? draft.data.death_ref_index : -1;
    let refsChanged = false;

    // A birth/death Event is now also worth creating/keeping around for a
    // place alone, not just a date -- recording where without exactly when
    // is a normal case genealogists hit constantly.
    const hasBirthInfo = Boolean(birthDate) || Boolean(birthPlace);
    if (hasBirthInfo && birthEvent) {
      update.push({
        type: "event",
        handle: birthEvent.handle,
        data: { ...birthEvent.data, date: birthDate, place: birthPlace?.handle ?? "" },
      });
      if (birthPlace?.pendingData) create.push(birthPlace.pendingData);
    } else if (hasBirthInfo && !birthEvent) {
      const handle = pendingBirthHandle ?? createHandle();
      if (!pendingBirthHandle) setPendingBirthHandle(handle);
      create.push({ _class: "Event", handle, type: "Birth", date: birthDate, place: birthPlace?.handle ?? "" });
      if (birthPlace?.pendingData) create.push(birthPlace.pendingData);
      if (birthRefIndex < 0) {
        eventRefList = [...eventRefList, { _class: "EventRef", ref: handle, role: "Primary" }];
        birthRefIndex = eventRefList.length - 1;
        refsChanged = true;
      }
    } else if (!hasBirthInfo && pendingBirthHandle) {
      eventRefList = eventRefList.filter((r) => r.ref !== pendingBirthHandle);
      birthRefIndex = -1;
      refsChanged = true;
      setPendingBirthHandle(null);
    }

    const hasDeathInfo = Boolean(deathDate) || Boolean(deathPlace);
    if (hasDeathInfo && deathEvent) {
      update.push({
        type: "event",
        handle: deathEvent.handle,
        data: { ...deathEvent.data, date: deathDate, place: deathPlace?.handle ?? "" },
      });
      if (deathPlace?.pendingData) create.push(deathPlace.pendingData);
    } else if (hasDeathInfo && !deathEvent) {
      const handle = pendingDeathHandle ?? createHandle();
      if (!pendingDeathHandle) setPendingDeathHandle(handle);
      create.push({ _class: "Event", handle, type: "Death", date: deathDate, place: deathPlace?.handle ?? "" });
      if (deathPlace?.pendingData) create.push(deathPlace.pendingData);
      if (deathRefIndex < 0) {
        eventRefList = [...eventRefList, { _class: "EventRef", ref: handle, role: "Primary" }];
        deathRefIndex = eventRefList.length - 1;
        refsChanged = true;
      }
    } else if (!hasDeathInfo && pendingDeathHandle) {
      eventRefList = eventRefList.filter((r) => r.ref !== pendingDeathHandle);
      deathRefIndex = -1;
      refsChanged = true;
      setPendingDeathHandle(null);
    }

    if (refsChanged) {
      onChange({ event_ref_list: eventRefList, birth_ref_index: birthRefIndex, death_ref_index: deathRefIndex });
    }
    onSetExtraObjects({ create, update });
    // draft.data/onChange/onSetExtraObjects deliberately excluded -- see
    // the comment above this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [birthDate, deathDate, birthEvent, deathEvent, pendingBirthHandle, pendingDeathHandle, birthPlace, deathPlace]);

  const title = draft.mode === "edit" ? "Edit Person" : "New Person";

  const name = (draft.data.primary_name ?? {}) as Record<string, unknown>;
  const givenName = (name.first_name as string | undefined) ?? "";
  const surnameList = (name.surname_list as Record<string, unknown>[] | undefined) ?? [];
  const surname = (surnameList[0]?.surname as string | undefined) ?? "";
  const gender = String(draft.data.gender ?? 2);
  const alternateNames = (draft.data.alternate_names as Record<string, unknown>[] | undefined) ?? [];

  /** Patches one field of primary_name, preserving every other field --
   * important in edit mode, where `name` already carries server-side
   * fields this dialog doesn't surface (group_as, sort_as, citation_list,
   * ...) that a from-scratch rebuild would silently drop. */
  function patchName(key: "first_name" | "surname", value: string) {
    if (key === "surname") {
      const nextList = surnameList.length > 0
        ? [{ ...surnameList[0], _class: "Surname", surname: value }, ...surnameList.slice(1)]
        : [{ _class: "Surname", surname: value }];
      onChange({ primary_name: { _class: "Name", ...name, surname_list: nextList } });
      return;
    }
    onChange({ primary_name: { _class: "Name", ...name, [key]: value } });
  }

  /** Same "preserve every other field" merge as patchName, but for whatever
   * key(s) the "More name details…" dialog (NameEditDialog) touches --
   * title/suffix/call/nick/famnick/type/private/date/surname_list/
   * group_as/sort_as/display_as -- rather than one hand-listed key at a
   * time. */
  function patchPrimaryName(patch: Record<string, unknown>) {
    onChange({ primary_name: { _class: "Name", ...name, ...patch } });
  }

  function altNameLabel(n: Record<string, unknown>): string {
    const given = (n.first_name as string | undefined) ?? "";
    const surn = ((n.surname_list as Record<string, unknown>[] | undefined)?.[0]?.surname as string | undefined) ?? "";
    return [given, surn].filter(Boolean).join(" ") || "(unnamed)";
  }

  function addAlternateName() {
    const id = createHandle();
    setAltIds((prev) => [...prev, id]);
    setEverAltIds((prev) => [...prev, id]);
    setOpenAltIds((prev) => [...prev, id]);
    onChange({
      alternate_names: [
        ...alternateNames,
        { _class: "Name", first_name: "", surname_list: [{ _class: "Surname", surname: "" }] },
      ],
    });
  }

  function removeAlternateName(id: string) {
    const idx = altIds.indexOf(id);
    if (idx < 0) return;
    setAltIds((prev) => prev.filter((x) => x !== id));
    setOpenAltIds((prev) => prev.filter((x) => x !== id));
    onChange({ alternate_names: alternateNames.filter((_, j) => j !== idx) });
  }

  // Shared by Citations/Notes/Tags -- all three are plain handle lists with
  // no per-entry metadata of their own, so one set of handlers covers all
  // three (Associations/Media each need their own -- see below -- since
  // their entries carry `rel`/are never a nested draft, respectively).
  function addNewToPlainList(type: DraftType, fieldPrefix: string, listKey: string, currentRefs: string[]) {
    onChange(openNewListItemPatch(onOpenDraft, type, fieldPrefix, listKey, currentRefs));
  }
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

  function handleAssocAddExisting(item: QueryItem, rel: string) {
    setPickedLabels((prev) => ({ ...prev, [item.handle]: personLabel(item) }));
    onChange({ person_ref_list: [...assocRefs, { _class: "PersonRef", ref: item.handle, rel }] });
  }
  function handleAddNewAssociation(rel: string) {
    const field = `${ASSOC_FIELD_PREFIX}${createHandle()}`;
    const handle = onOpenDraft("person", field);
    onChange({ [field]: undefined, person_ref_list: [...assocRefs, { _class: "PersonRef", ref: handle, rel }] });
  }
  function handleAssocRemove(handle: string) {
    onChange({ person_ref_list: assocRefs.filter((r) => r.ref !== handle) });
  }

  function handleEventAddExisting(item: QueryItem, role: string) {
    setPickedLabels((prev) => ({ ...prev, [item.handle]: pickerResultLabel("event", item) }));
    onChange(withReindexedBirthDeath([...fullEventRefs, { _class: "EventRef", ref: item.handle, role }]));
  }
  function handleAddNewEvent(role: string) {
    const field = `${EVENT_FIELD_PREFIX}${createHandle()}`;
    const handle = onOpenDraft("event", field);
    onChange({
      [field]: undefined,
      ...withReindexedBirthDeath([...fullEventRefs, { _class: "EventRef", ref: handle, role }]),
    });
  }
  function handleEventRemove(handle: string) {
    onChange(withReindexedBirthDeath(fullEventRefs.filter((r) => r.ref !== handle)));
  }

  // Computed rather than three separate early `return`s -- draft.status
  // cycles back through "loading" on a re-Edit of an already-cancelled
  // draft (draftStack.ts's openEditDraft resets the same entry rather than
  // creating a new one), and an early return here would drop the
  // NameEditDialog Modals below out of the tree for that stretch, unmounting
  // an already-registered Mantine ModalStack entry -- unsafe for the same
  // reason EditDialogs.tsx never conditionally omits a draft's own dialog.
  let modalBody: ReactNode;
  if (draft.status === "loading") {
    modalBody = (
      <Group justify="center" py="md">
        <Loader size="sm" />
      </Group>
    );
  } else if (draft.status === "error") {
    modalBody = (
      <Stack gap="md">
        <Alert color="red" title={t("Could not load")}>{draft.loadError}</Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>{t("Close")}</Button>
        </Group>
      </Stack>
    );
  } else {
    modalBody = (
      <Stack gap="md">
        <TextInput
          label={t("Gramps ID")}
          placeholder={t("auto-assigned")}
          value={(draft.data.gramps_id as string | undefined) ?? ""}
          onChange={(e) => onChange({ gramps_id: e.currentTarget.value })}
        />
        <TextInput
          label={t("Given name")}
          value={givenName}
          onChange={(e) => patchName("first_name", e.currentTarget.value)}
          autoFocus
        />
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <TextInput
            label={t("Surname")}
            value={surname}
            onChange={(e) => patchName("surname", e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <CircleGlyphButton glyph="»" label={t("Edit full name details")} onClick={() => setPrimaryNameOpen(true)} size={34} />
        </Group>
        <Select
          label={t("Gender")}
          data={GENDER_OPTIONS}
          value={gender}
          onChange={(next) => onChange({ gender: Number(next ?? 2) })}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />

        <Anchor component="button" type="button" size="sm" onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? "▾" : "▸"} Details
        </Anchor>
        <Collapse in={showDetails}>
          <Stack gap="md">
            <DateInput id={`${draft.handle}-birth-date`} label={t("Birth date")} value={birthDate} onChange={setBirthDate} />
            <EventPlaceField
              label={t("Birth place")}
              id={`${draft.handle}-birth-place`}
              value={birthPlace}
              onChange={setBirthPlace}
            />
            <DateInput id={`${draft.handle}-death-date`} label={t("Death date")} value={deathDate} onChange={setDeathDate} />
            <EventPlaceField
              label={t("Death place")}
              id={`${draft.handle}-death-place`}
              value={deathPlace}
              onChange={setDeathPlace}
            />
            <Switch
              label={t("Private")}
              checked={Boolean(draft.data.private)}
              onChange={(e) => onChange({ private: e.currentTarget.checked })}
            />

            <Stack gap={4}>
              <Text size="sm" fw={500}>{t("Alternate names")}</Text>
              {altIds.length === 0 && <Text size="xs" c="dimmed">{t("No alternate names")}</Text>}
              {altIds.map((id, i) => (
                <Group key={id} gap="xs">
                  <Anchor
                    component="button"
                    type="button"
                    size="sm"
                    onClick={() => setOpenAltIds((prev) => (prev.includes(id) ? prev : [...prev, id]))}
                  >
                    {altNameLabel(alternateNames[i] ?? {})}
                  </Anchor>
                  <CircleGlyphButton
                    glyph="−"
                    label={t("Remove alternate name")}
                    onClick={() => removeAlternateName(id)}
                    size={16}
                  />
                </Group>
              ))}
              <CircleGlyphButton
                glyph="+"
                label={t("Add alternate name")}
                textLabel="Add alternate name"
                onClick={addAlternateName}
              />
            </Stack>

            <AttributeListField
              items={(draft.data.attribute_list as Attribute[] | undefined) ?? []}
              onChange={(items) => onChange({ attribute_list: items })}
            />
            <AddressListField
              items={(draft.data.address_list as Address[] | undefined) ?? []}
              onChange={(items) => onChange({ address_list: items })}
            />
            <UrlListField
              items={(draft.data.urls as Url[] | undefined) ?? []}
              onChange={(items) => onChange({ urls: items })}
            />

            <AssociationsField
              refs={assocRefs}
              labels={pickedLabels}
              newDrafts={newDraftsByHandle(stack, draft.handle, "person", ASSOC_FIELD_PREFIX)}
              findEdit={(h) => findEditDraft(stack, draft.handle, ASSOC_EDIT_FIELD_PREFIX, h)}
              onAdd={handleAssocAddExisting}
              onAddNew={handleAddNewAssociation}
              onRemove={handleAssocRemove}
              onOpenEditDraft={(h) => openEditListItem("person", ASSOC_EDIT_FIELD_PREFIX, h)}
              onReopenDraft={onShowDraft}
              onCancelDraft={onCloseDraft}
            />

            <RefListField
              label={t("Citations")}
              refs={citationRefs}
              labels={pickedLabels}
              newDraftsByHandle={newDraftsByHandle(stack, draft.handle, "citation", CITATION_FIELD_PREFIX)}
              findEditDraft={(h) => findEditDraft(stack, draft.handle, CITATION_EDIT_FIELD_PREFIX, h)}
              onAddExisting={(item) => addExistingToPlainList("citation_list", citationRefs, item, "citation")}
              onAddNew={() => addNewToPlainList("citation", CITATION_FIELD_PREFIX, "citation_list", citationRefs)}
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
              label={t("Notes")}
              refs={noteRefs}
              labels={pickedLabels}
              newDraftsByHandle={newDraftsByHandle(stack, draft.handle, "note", NOTE_FIELD_PREFIX)}
              findEditDraft={(h) => findEditDraft(stack, draft.handle, NOTE_EDIT_FIELD_PREFIX, h)}
              onAddExisting={(item) => addExistingToPlainList("note_list", noteRefs, item, "note")}
              onAddNew={() => addNewToPlainList("note", NOTE_FIELD_PREFIX, "note_list", noteRefs)}
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
              label={t("Media")}
              refs={mediaRefs}
              labels={pickedLabels}
              onAddExisting={handleMediaAddExisting}
              onAdded={handleMediaAdded}
              onRemove={handleMediaRemove}
            />

            <RefListField
              label={t("Tags")}
              refs={tagRefs}
              labels={pickedLabels}
              newDraftsByHandle={newDraftsByHandle(stack, draft.handle, "tag", TAG_FIELD_PREFIX)}
              findEditDraft={(h) => findEditDraft(stack, draft.handle, TAG_EDIT_FIELD_PREFIX, h)}
              onAddExisting={(item) => addExistingToPlainList("tag_list", tagRefs, item, "tag")}
              onAddNew={() => addNewToPlainList("tag", TAG_FIELD_PREFIX, "tag_list", tagRefs)}
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
              refs={otherEventRefs}
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
          <Alert color="red" title={t("Could not save")}>
            {error}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button onClick={onPrimary} loading={saving}>
            {t(primaryLabel)}
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <>
      <Modal opened={opened} onClose={onCancel} title={title} size="lg" stackId={draft.handle}>
        {modalBody}
      </Modal>

      <NameEditDialog
        stackId={`${draft.handle}-primary-name`}
        opened={primaryNameOpen}
        title={t("Primary Name")}
        data={name}
        onChange={patchPrimaryName}
        onDone={() => setPrimaryNameOpen(false)}
      />
      {everAltIds.map((id, everIdx) => {
        const idx = altIds.indexOf(id);
        const data = idx >= 0 ? alternateNames[idx] : undefined;
        return (
          <NameEditDialog
            key={id}
            stackId={`${draft.handle}-alt-name-${id}`}
            opened={idx >= 0 && openAltIds.includes(id)}
            title={`Alternate Name ${idx >= 0 ? idx + 1 : everIdx + 1}`}
            data={data ?? {}}
            onChange={(patch) => {
              if (idx < 0) return;
              onChange({
                alternate_names: alternateNames.map((n, j) => (j === idx ? { ...n, ...patch } : n)),
              });
            }}
            onDone={() => setOpenAltIds((prev) => prev.filter((x) => x !== id))}
            onRemove={idx >= 0 ? () => removeAlternateName(id) : undefined}
          />
        );
      })}
    </>
  );
}
