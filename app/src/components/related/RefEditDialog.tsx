import { useState } from "react";
import { Button, Group, Modal, Select, Stack, TextInput } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { patchRefListEntry } from "../../store/refListApi";
import type { RefMeta } from "../../store/objectDetail";
import type { ViewConfig } from "../../store/views";

// ChildRefType/EventRoleType/SourceMediaType built-ins (gramps/gen/lib/
// childreftype.py, eventroletype.py, srcmediatype.py) as plain English
// strings, "Custom" excluded -- same fix_object_dict()-on-save convention
// FamilyEditDialog's REL_TYPE_OPTIONS doc comment already explains for
// FamilyRelType, applied here to a *ref's* own frel/mrel/role/media_type
// instead of a whole object's type.
const CHILD_REL_OPTIONS = ["Birth", "Adopted", "Stepchild", "Sponsored", "Foster", "Unknown"];
const EVENT_ROLE_OPTIONS = [
  "Primary", "Clergy", "Celebrant", "Aide", "Bride", "Groom", "Witness", "Family",
  "Informant", "Godparent", "Father", "Mother", "Parent", "Child", "Multiple birth",
  "Friend", "Neighbor", "Officiator",
];
const REPO_MEDIA_TYPE_OPTIONS = [
  "Audio", "Book", "Card", "Electronic", "Fiche", "Film", "Magazine", "Manuscript",
  "Map", "Newspaper", "Photo", "Tombstone", "Video",
];

export type RefEditType = "child" | "event" | "person" | "repo";

const TITLES: Record<RefEditType, string> = {
  child: "Edit child relationship",
  event: "Edit role",
  person: "Edit association",
  repo: "Edit repository reference",
};

interface RefEditDialogProps {
  opened: boolean;
  onClose: () => void;
  refType: RefEditType;
  /** Whose listField is being patched -- the record that owns the ref
   * struct. For most sections this is the section's own `detail`, but
   * ParticipantsSection's rows are a reverse lookup (see its own doc
   * comment): the ref actually lives on the *participant's* own
   * event_ref_list, so that section passes the participant's own
   * view/handle here instead of the Event's. */
  view: ViewConfig;
  objectHandle: string;
  listField: string;
  /** The `ref` handle identifying which entry of `objectHandle`'s
   * `listField` to patch. */
  targetHandle: string;
  refMeta: RefMeta;
  onSaved: () => void;
}

/** Edits a reference's own relationship metadata (frel/mrel/role/rel/
 * call_number/media_type) -- distinct from RelatedPanel's header
 * EditButton, which edits the *target object*. Mirrors AttachControl's own
 * self-contained GET/PUT (refListApi.ts's patchRefListEntry) rather than
 * draftStack's deferred-save flow -- a relationship edit is one or two
 * fields on one ref, not worth the stacked-draft machinery a whole-object
 * edit needs. Mounted fresh each time a row's edit icon is clicked (see the
 * `editing && <RefEditDialog ... />` pattern in ChildrenSection.tsx etc.),
 * so its own local field state always starts from that row's current
 * `refMeta` with no separate sync effect needed. */
export function RefEditDialog({
  opened, onClose, refType, view, objectHandle, listField, targetHandle, refMeta, onSaved,
}: RefEditDialogProps) {
  const [frel, setFrel] = useState(refMeta.frel ?? "");
  const [mrel, setMrel] = useState(refMeta.mrel ?? "");
  const [role, setRole] = useState(refMeta.role ?? "");
  const [rel, setRel] = useState(refMeta.rel ?? "");
  const [callNumber, setCallNumber] = useState(refMeta.call_number ?? "");
  const [mediaType, setMediaType] = useState(refMeta.media_type ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const patch: Record<string, unknown> =
      refType === "child" ? { frel, mrel } :
      refType === "event" ? { role } :
      refType === "person" ? { rel } :
      { call_number: callNumber, media_type: mediaType };
    setSaving(true);
    try {
      const token = await getToken();
      await patchRefListEntry(token, view, objectHandle, listField, targetHandle, patch);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={TITLES[refType]} size="sm">
      <Stack gap="sm">
        {refType === "child" && (
          <>
            <Select
              label="Relationship to father"
              data={CHILD_REL_OPTIONS}
              value={frel || null}
              onChange={(next) => setFrel(next ?? "")}
            />
            <Select
              label="Relationship to mother"
              data={CHILD_REL_OPTIONS}
              value={mrel || null}
              onChange={(next) => setMrel(next ?? "")}
            />
          </>
        )}
        {refType === "event" && (
          <Select
            label="Role"
            data={EVENT_ROLE_OPTIONS}
            value={role || null}
            onChange={(next) => setRole(next ?? "")}
          />
        )}
        {refType === "person" && (
          <TextInput
            label="Relationship"
            placeholder="e.g. Godfather"
            value={rel}
            onChange={(e) => setRel(e.currentTarget.value)}
          />
        )}
        {refType === "repo" && (
          <>
            <TextInput
              label="Call number"
              value={callNumber}
              onChange={(e) => setCallNumber(e.currentTarget.value)}
            />
            <Select
              label="Media type"
              data={REPO_MEDIA_TYPE_OPTIONS}
              value={mediaType || null}
              onChange={(next) => setMediaType(next ?? "")}
            />
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
