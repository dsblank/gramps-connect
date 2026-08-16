import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert, Anchor, Button, Collapse, Group, Loader, Modal, Select, Stack, Switch, Text, TextInput,
} from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { getToken } from "../auth/auth";
import { createHandle, fetchPlainObject } from "../store/objectsApi";
import { EVENT_VIEW } from "../store/views";
import type { DraftEntry } from "../store/draftStack";
import { DateInput } from "./DateInput";
import {
  AttributeListField, AddressListField, UrlListField, type Attribute, type Address, type Url,
} from "./EmbeddedListFields";
import { NameEditDialog } from "./NameEditDialog";
import { EventPlaceField, type EventPlaceValue } from "./EventPlaceField";
import { CircleGlyphButton } from "./CircleGlyphButton";

// Person.{FEMALE,MALE,UNKNOWN,OTHER} (gramps/gen/lib/person.py) -- gender is
// a plain integer on the wire, not a GrampsType struct.
const GENDER_OPTIONS = [
  { value: "2", label: "Unknown" },
  { value: "1", label: "Male" },
  { value: "0", label: "Female" },
  { value: "3", label: "Other" },
];

interface PersonEditDialogProps {
  draft: DraftEntry;
  /** EditDialogs.tsx renders one of these for every draft ever opened this
   * session, active or not (see draftStack.ts's DraftEntry.active doc
   * comment for why) -- this prop, not mount/unmount, is what actually
   * shows or hides it. */
  opened: boolean;
  onChange: (patch: Record<string, unknown>) => void;
  onSetExtraObjects: (extra: { create: Record<string, unknown>[]; update: DraftEntry["extraUpdate"] }) => void;
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
 * (name extras, privacy, birth/death date) -- see the plan for why birth/
 * death needs its own Event create/update handling below rather than being
 * a flat Person field. */
export function PersonEditDialog({
  draft, opened, onChange, onSetExtraObjects, onCancel, primaryLabel, onPrimary, saving, error,
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
        <Alert color="red" title="Could not load">{draft.loadError}</Alert>
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel}>Close</Button>
        </Group>
      </Stack>
    );
  } else {
    modalBody = (
      <Stack gap="md">
        <TextInput
          label="Gramps ID"
          placeholder="auto-assigned"
          value={(draft.data.gramps_id as string | undefined) ?? ""}
          onChange={(e) => onChange({ gramps_id: e.currentTarget.value })}
        />
        <TextInput
          label="Given name"
          value={givenName}
          onChange={(e) => patchName("first_name", e.currentTarget.value)}
          autoFocus
        />
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <TextInput
            label="Surname"
            value={surname}
            onChange={(e) => patchName("surname", e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button variant="default" onClick={() => setPrimaryNameOpen(true)}>
            More…
          </Button>
        </Group>
        <Select
          label="Gender"
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
            <DateInput label="Birth date" value={birthDate} onChange={setBirthDate} />
            <EventPlaceField
              label="Birth place"
              id={`${draft.handle}-birth-place`}
              value={birthPlace}
              onChange={setBirthPlace}
            />
            <DateInput label="Death date" value={deathDate} onChange={setDeathDate} />
            <EventPlaceField
              label="Death place"
              id={`${draft.handle}-death-place`}
              value={deathPlace}
              onChange={setDeathPlace}
            />
            <Switch
              label="Private"
              checked={Boolean(draft.data.private)}
              onChange={(e) => onChange({ private: e.currentTarget.checked })}
            />

            <Stack gap={4}>
              <Text size="sm" fw={500}>Alternate names</Text>
              {altIds.length === 0 && <Text size="xs" c="dimmed">No alternate names</Text>}
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
                    label="Remove alternate name"
                    onClick={() => removeAlternateName(id)}
                    size={16}
                  />
                </Group>
              ))}
              <CircleGlyphButton
                glyph="+"
                label="Add alternate name"
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
        title="Primary Name"
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
