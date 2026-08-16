import { Button, Group, Modal, Stack, Switch, TextInput } from "@mantine/core";
import { UrlListField, type Url } from "./EmbeddedListFields";

const TYPE_HINT = "e.g. a built-in name, or your own custom label…";

interface PlaceEditDialogProps {
  stackId: string;
  opened: boolean;
  title: string;
  data: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  onDone: () => void;
}

/** Full editor for one Place struct -- reusable the same way NameEditDialog.tsx
 * is: purely presentational (data in, patches out via onChange, no API calls
 * of its own), so a caller can bind it to whatever persistence shape fits --
 * a nested draftStack "place" DraftEntry (ObjectEditDialog.tsx's Place
 * reference fields), a locally-deferred birth/death Event's place
 * (PersonEditDialog.tsx), or an immediately-saved local dict (RelatedPanel's
 * event-creation dialog). Unlike Name, a Place is a real top-level object
 * with its own handle -- top-level New/Edit Place (MenuBar, the Places view)
 * still goes through ObjectEditDialog.tsx's own FIELD_SPECS-driven dialog,
 * unchanged; this component only ever appears nested inside another dialog
 * (see the plan). Same field set as that FIELD_SPECS entry (name, type,
 * lat, long, private, urls) so both stay in sync by inspection. */
export function PlaceEditDialog({ stackId, opened, title, data, onChange, onDone }: PlaceEditDialogProps) {
  const name = (data.name ?? {}) as Record<string, unknown>;
  const titleValue = (name.value as string | undefined) ?? (data.title as string | undefined) ?? "";

  return (
    <Modal opened={opened} onClose={onDone} title={title} size="md" stackId={stackId}>
      <Stack gap="md">
        <TextInput
          label="Name"
          value={titleValue}
          onChange={(e) => {
            const v = e.currentTarget.value;
            onChange({ title: v, name: { _class: "PlaceName", ...name, value: v } });
          }}
          autoFocus
        />
        <TextInput
          label="Type"
          placeholder={TYPE_HINT}
          value={(data.place_type as string | undefined) ?? ""}
          onChange={(e) => onChange({ place_type: e.currentTarget.value })}
        />
        <TextInput
          label="Latitude"
          value={(data.lat as string | undefined) ?? ""}
          onChange={(e) => onChange({ lat: e.currentTarget.value })}
        />
        <TextInput
          label="Longitude"
          value={(data.long as string | undefined) ?? ""}
          onChange={(e) => onChange({ long: e.currentTarget.value })}
        />
        <Switch
          label="Private"
          checked={Boolean(data.private)}
          onChange={(e) => onChange({ private: e.currentTarget.checked })}
        />
        <UrlListField
          items={(data.urls as Url[] | undefined) ?? []}
          onChange={(items) => onChange({ urls: items })}
        />
        <Group justify="flex-end">
          <Button onClick={onDone}>Done</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
