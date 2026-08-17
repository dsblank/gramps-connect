import { useState } from "react";
import { Modal, Stack, TextInput } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { attachRefListEntry } from "../../store/refListApi";
import { PERSON_VIEW } from "../../store/views";
import { RecordPicker } from "../RecordPicker";
import { withGrampsId } from "./summary";
import type { QueryItem } from "../../store/api";
import type { ViewConfig } from "../../store/views";

function personPickerLabel(item: QueryItem): string {
  const given = (item.given_name as string | undefined) ?? "";
  const surname = (item.surname as string | undefined) ?? "";
  const name = [given, surname].filter(Boolean).join(" ") || "(unnamed)";
  return withGrampsId(item.gramps_id as string | undefined, name);
}

interface AssociationCreateDialogProps {
  opened: boolean;
  onClose: () => void;
  view: ViewConfig;
  objectHandle: string;
  onSaved: () => void;
}

/** "+ Add association" for AssociationsSection -- Person.person_ref_list,
 * each entry a PersonRef carrying its own free-text `rel` ("Godfather",
 * "Witness", ...). Picks an *existing* Person (RecordPicker over
 * PERSON_VIEW, same confirm-with-button convention as AttachControl.tsx's
 * own dialogs) and attaches it with whatever `rel` text was typed --
 * attachRefListEntry's `entry` already accepts extra fields alongside
 * `_class`/`ref` (see its own doc comment), so no store-layer change was
 * needed to carry `rel` along with the pick. Not built on AttachControl
 * itself: that component's dialog is picker-only, with no room for this
 * second field, and Association is the only one of its four callers that
 * needs one. */
export function AssociationCreateDialog({ opened, onClose, view, objectHandle, onSaved }: AssociationCreateDialogProps) {
  const [rel, setRel] = useState("");
  const [saving, setSaving] = useState(false);

  function resetAndClose() {
    setRel("");
    onClose();
  }

  async function handlePick(item: QueryItem) {
    setSaving(true);
    try {
      const token = await getToken();
      await attachRefListEntry(token, view, objectHandle, "person_ref_list", {
        _class: "PersonRef", ref: item.handle, rel,
      });
      resetAndClose();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened={opened} onClose={resetAndClose} title="Adding an association" size="sm">
      <Stack gap="sm">
        <TextInput
          label="Relationship"
          placeholder="e.g. Godfather"
          value={rel}
          onChange={(e) => setRel(e.currentTarget.value)}
          disabled={saving}
          autoFocus
        />
        <RecordPicker
          view={PERSON_VIEW}
          searchField="gramps_id"
          placeholder={PERSON_VIEW.simpleSearch?.placeholder ?? "Search…"}
          buildExpr={PERSON_VIEW.simpleSearch?.buildExpr}
          renderLabel={personPickerLabel}
          onPick={handlePick}
          confirmWithButton
        />
      </Stack>
    </Modal>
  );
}
