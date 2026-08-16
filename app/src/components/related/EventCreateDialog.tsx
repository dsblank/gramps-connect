import { useState } from "react";
import { Button, Group, Modal, Select, Stack, Switch, TextInput } from "@mantine/core";
import type { GrampsDate } from "@gramps-connect/gramps-date";
import { getToken } from "../../auth/auth";
import { createHandle, createObjects } from "../../store/objectsApi";
import { attachRefListEntry } from "../../store/refListApi";
import type { ViewConfig } from "../../store/views";
import { DateInput } from "../DateInput";
import { EventPlaceField, type EventPlaceValue } from "../EventPlaceField";
import { EVENT_ROLE_OPTIONS } from "./RefEditDialog";

const TYPE_HINT = "e.g. a built-in name, or your own custom label…";

interface EventCreateDialogProps {
  opened: boolean;
  onClose: () => void;
  /** Whose event_ref_list this new Event gets attached to -- Person or
   * Family, both share EventBase (see EventsSection.tsx's own doc
   * comment). */
  view: ViewConfig;
  objectHandle: string;
  onSaved: () => void;
}

/** "+ New Event" for RelatedPanel's Events section (EventsSection.tsx) --
 * self-contained, own POST/PUT, no draftStack: mirrors
 * AttachControl.tsx/RefEditDialog.tsx's existing convention, since this
 * section only ever renders for an already-saved Person/Family, with no
 * pending-draft save to defer to. Unlike Notes/Citations/Tags/Media's
 * AttachControl, this *creates* a new Event rather than attaching an
 * existing one -- Events aren't picked from a shared pool the way Notes/
 * Citations are, you make a new one for this Person/Family (see the plan).
 * A plain Modal, not registered with Mantine's ModalStack (no `stackId`,
 * same as RefEditDialog.tsx/AttachControl.tsx) -- this whole tree sits
 * outside EditDialogs.tsx's `<Modal.Stack>`, so EventsSection.tsx is free
 * to mount/unmount this conditionally the same way it already does
 * RefEditDialog, with no unmount-a-registered-Modal risk (EventPlaceField's
 * own nested PlaceEditDialog Modal included -- its `stackId` prop is inert
 * without a Modal.Stack ancestor). */
export function EventCreateDialog({ opened, onClose, view, objectHandle, onSaved }: EventCreateDialogProps) {
  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState<GrampsDate | null>(null);
  const [place, setPlace] = useState<EventPlaceValue | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [role, setRole] = useState("Primary");
  const [saving, setSaving] = useState(false);

  function resetAndClose() {
    setType("");
    setDescription("");
    setDate(null);
    setPlace(null);
    setIsPrivate(false);
    setRole("Primary");
    onClose();
  }

  async function handleSave() {
    setSaving(true);
    try {
      const token = await getToken();
      const handle = createHandle();
      const eventDict: Record<string, unknown> = {
        _class: "Event", handle, type, description, date, private: isPrivate, place: place?.handle ?? "",
      };
      const batch = place?.pendingData ? [eventDict, place.pendingData] : [eventDict];
      await createObjects(token, batch);
      await attachRefListEntry(token, view, objectHandle, "event_ref_list", { _class: "EventRef", ref: handle, role });
      resetAndClose();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened={opened} onClose={resetAndClose} title="New Event" size="md">
      <Stack gap="md">
        <TextInput
          label="Type"
          placeholder={TYPE_HINT}
          value={type}
          onChange={(e) => setType(e.currentTarget.value)}
          autoFocus
        />
        <TextInput label="Description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
        <DateInput label="Date" value={date} onChange={setDate} />
        <EventPlaceField label="Place" id={`${objectHandle}-new-event-place`} value={place} onChange={setPlace} />
        <Select
          label="Role"
          data={EVENT_ROLE_OPTIONS}
          value={role}
          onChange={(next) => setRole(next ?? "Primary")}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />
        <Switch label="Private" checked={isPrivate} onChange={(e) => setIsPrivate(e.currentTarget.checked)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={resetAndClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving}>
            Add
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
