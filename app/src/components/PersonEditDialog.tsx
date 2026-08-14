import { useEffect, useState } from "react";
import {
  Alert, Anchor, Button, Collapse, Group, Loader, Modal, Select, Stack, Switch, TextInput,
} from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { getToken } from "../auth/auth";
import { createHandle, fetchPlainObject } from "../store/objectsApi";
import { EVENT_VIEW } from "../store/views";
import type { DraftEntry } from "../store/draftStack";
import { SimpleDateInput } from "./SimpleDateInput";

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
  const [eventsLoaded, setEventsLoaded] = useState(false);

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
      }
      if (deathIdx >= 0 && eventRefs[deathIdx]) {
        const data = await fetchPlainObject(token, EVENT_VIEW, eventRefs[deathIdx].ref);
        setDeathEvent({ handle: eventRefs[deathIdx].ref, data });
        setDeathDate((data.date as GrampsDate | undefined) ?? null);
      }
    })();
  }, [draft.mode, draft.status, eventsLoaded]);

  // Derives extraCreate/extraUpdate (draftStack.ts) plus, when a brand-new
  // Event needs linking, a patch to the Person's own event_ref_list/
  // birth_ref_index/death_ref_index -- from birth/deathDate and what's
  // already known about an existing/pending Event, not from draft.data
  // (which this effect itself writes back via onChange -- including it in
  // the dependency list would create a feedback loop).
  useEffect(() => {
    const create: Record<string, unknown>[] = [];
    const update: DraftEntry["extraUpdate"] = [];
    let eventRefList = [...((draft.data.event_ref_list as EventRefLike[] | undefined) ?? [])];
    let birthRefIndex = typeof draft.data.birth_ref_index === "number" ? draft.data.birth_ref_index : -1;
    let deathRefIndex = typeof draft.data.death_ref_index === "number" ? draft.data.death_ref_index : -1;
    let refsChanged = false;

    if (birthDate && birthEvent) {
      update.push({ type: "event", handle: birthEvent.handle, data: { ...birthEvent.data, date: birthDate } });
    } else if (birthDate && !birthEvent) {
      const handle = pendingBirthHandle ?? createHandle();
      if (!pendingBirthHandle) setPendingBirthHandle(handle);
      create.push({ _class: "Event", handle, type: "Birth", date: birthDate });
      if (birthRefIndex < 0) {
        eventRefList = [...eventRefList, { _class: "EventRef", ref: handle, role: "Primary" }];
        birthRefIndex = eventRefList.length - 1;
        refsChanged = true;
      }
    } else if (!birthDate && !birthEvent && pendingBirthHandle) {
      eventRefList = eventRefList.filter((r) => r.ref !== pendingBirthHandle);
      birthRefIndex = -1;
      refsChanged = true;
      setPendingBirthHandle(null);
    }

    if (deathDate && deathEvent) {
      update.push({ type: "event", handle: deathEvent.handle, data: { ...deathEvent.data, date: deathDate } });
    } else if (deathDate && !deathEvent) {
      const handle = pendingDeathHandle ?? createHandle();
      if (!pendingDeathHandle) setPendingDeathHandle(handle);
      create.push({ _class: "Event", handle, type: "Death", date: deathDate });
      if (deathRefIndex < 0) {
        eventRefList = [...eventRefList, { _class: "EventRef", ref: handle, role: "Primary" }];
        deathRefIndex = eventRefList.length - 1;
        refsChanged = true;
      }
    } else if (!deathDate && !deathEvent && pendingDeathHandle) {
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
  }, [birthDate, deathDate, birthEvent, deathEvent, pendingBirthHandle, pendingDeathHandle]);

  const title = draft.mode === "edit" ? "Edit Person" : "New Person";

  if (draft.status === "loading") {
    return (
      <Modal opened={opened} onClose={onCancel} title={title} stackId={draft.handle}>
        <Group justify="center" py="md">
          <Loader size="sm" />
        </Group>
      </Modal>
    );
  }
  if (draft.status === "error") {
    return (
      <Modal opened={opened} onClose={onCancel} title={title} stackId={draft.handle}>
        <Stack gap="md">
          <Alert color="red" title="Could not load">{draft.loadError}</Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={onCancel}>Close</Button>
          </Group>
        </Stack>
      </Modal>
    );
  }

  const name = (draft.data.primary_name ?? {}) as Record<string, unknown>;
  const givenName = (name.first_name as string | undefined) ?? "";
  const surnameList = (name.surname_list as Record<string, unknown>[] | undefined) ?? [];
  const surname = (surnameList[0]?.surname as string | undefined) ?? "";
  const title_ = (name.title as string | undefined) ?? "";
  const suffix = (name.suffix as string | undefined) ?? "";
  const call = (name.call as string | undefined) ?? "";
  const nick = (name.nick as string | undefined) ?? "";
  const gender = String(draft.data.gender ?? 2);

  /** Patches one field of primary_name, preserving every other field --
   * important in edit mode, where `name` already carries server-side
   * fields this dialog doesn't surface (group_as, sort_as, citation_list,
   * ...) that a from-scratch rebuild would silently drop. */
  function patchName(key: "first_name" | "surname" | "title" | "suffix" | "call" | "nick", value: string) {
    if (key === "surname") {
      const nextList = surnameList.length > 0
        ? [{ ...surnameList[0], _class: "Surname", surname: value }, ...surnameList.slice(1)]
        : [{ _class: "Surname", surname: value }];
      onChange({ primary_name: { _class: "Name", ...name, surname_list: nextList } });
      return;
    }
    onChange({ primary_name: { _class: "Name", ...name, [key]: value } });
  }

  return (
    <Modal opened={opened} onClose={onCancel} title={title} stackId={draft.handle}>
      <Stack gap="md">
        <TextInput
          label="Given name"
          value={givenName}
          onChange={(e) => patchName("first_name", e.currentTarget.value)}
          autoFocus
        />
        <TextInput
          label="Surname"
          value={surname}
          onChange={(e) => patchName("surname", e.currentTarget.value)}
        />
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
            <SimpleDateInput label="Birth date" value={birthDate} onChange={setBirthDate} />
            <SimpleDateInput label="Death date" value={deathDate} onChange={setDeathDate} />
            <TextInput label="Title" value={title_} onChange={(e) => patchName("title", e.currentTarget.value)} />
            <TextInput label="Suffix" value={suffix} onChange={(e) => patchName("suffix", e.currentTarget.value)} />
            <TextInput label="Call name" value={call} onChange={(e) => patchName("call", e.currentTarget.value)} />
            <TextInput label="Nickname" value={nick} onChange={(e) => patchName("nick", e.currentTarget.value)} />
            <Switch
              label="Private"
              checked={Boolean(draft.data.private)}
              onChange={(e) => onChange({ private: e.currentTarget.checked })}
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
