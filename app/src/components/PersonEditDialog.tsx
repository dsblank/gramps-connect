import { Alert, Button, Group, Modal, Select, Stack, TextInput } from "@mantine/core";
import type { DraftEntry } from "../store/draftStack";

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
  onCancel: () => void;
  /** "Done" (nested -- just hides this dialog, keeps the draft in the
   * pending save) or "Save" (top-level -- actually POSTs), decided by
   * EditDialogs.tsx based on whether this draft has an openedFrom. */
  primaryLabel: string;
  onPrimary: () => void;
  saving: boolean;
  error: string | null;
}

/** One "New Person" dialog in the stack -- MVP fields only (name, gender);
 * see the plan's "Explicitly out of scope" section for what's deferred. */
export function PersonEditDialog({
  draft, opened, onChange, onCancel, primaryLabel, onPrimary, saving, error,
}: PersonEditDialogProps) {
  const name = (draft.data.primary_name ?? {}) as {
    first_name?: string;
    surname_list?: { surname?: string }[];
  };
  const givenName = name.first_name ?? "";
  const surname = name.surname_list?.[0]?.surname ?? "";
  const gender = String(draft.data.gender ?? 2);

  function setName(patch: { first_name?: string; surname?: string }) {
    onChange({
      primary_name: {
        _class: "Name",
        first_name: patch.first_name ?? givenName,
        surname_list: [{ _class: "Surname", surname: patch.surname ?? surname }],
      },
    });
  }

  return (
    <Modal opened={opened} onClose={onCancel} title="New Person" stackId={draft.handle}>
      <Stack gap="md">
        <TextInput
          label="Given name"
          value={givenName}
          onChange={(e) => setName({ first_name: e.currentTarget.value })}
          autoFocus
        />
        <TextInput
          label="Surname"
          value={surname}
          onChange={(e) => setName({ surname: e.currentTarget.value })}
        />
        <Select
          label="Gender"
          data={GENDER_OPTIONS}
          value={gender}
          onChange={(next) => onChange({ gender: Number(next ?? 2) })}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
        />

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
