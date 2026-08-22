import { useState } from "react";
import { Modal } from "@mantine/core";
import { getToken, hasPermissions } from "../../../auth/auth";
import { attachRefListEntry, detachRefListEntry } from "../../../store/refListApi";
import { FAMILY_VIEW, PERSON_VIEW, type ViewConfig } from "../../../store/views";
import { CircleGlyphButton } from "../../CircleGlyphButton";
import { RecordPicker } from "../../RecordPicker";
import { pickerResultLabel } from "../../RefPickerField";
import type { QueryItem } from "../../../store/api";
import { RefEditDialog } from "../RefEditDialog";
import { summaryLine } from "../summary";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";
import { t } from "../../../i18n/i18n";

interface EditingParticipant {
  view: ViewConfig;
  objectHandle: string;
  role: string;
}

/** "+" for this section is a reverse write, same shape as FamiliesSection's
 * own AddFamilyControl -- the ref being added lives on the *picked*
 * person/family's own event_ref_list, not on this Event, so `eventHandle`
 * (the attach target) and `pickerView`/`itemLabel` (what's being searched)
 * are two different things, unlike AttachControl where they're the same
 * object. Defaults role to "Primary", same as EventsSection's own forward-
 * direction attach -- fixing it after the fact is this section's existing
 * edit icon (RefEditDialog refType="event"), unchanged by this. */
function AddParticipantControl({ pickerView, eventHandle, itemLabel, onAdded }: {
  pickerView: ViewConfig;
  eventHandle: string;
  itemLabel: string;
  onAdded: () => void;
}) {
  const [opened, setOpened] = useState(false);
  if (!hasPermissions("EditObject")) return null;

  async function handlePick(item: QueryItem) {
    setOpened(false);
    const token = await getToken();
    await attachRefListEntry(token, pickerView, item.handle, "event_ref_list", {
      _class: "EventRef", ref: eventHandle, role: "Primary",
    });
    onAdded();
  }

  return (
    <>
      <CircleGlyphButton
        glyph="+"
        label={`Attach ${itemLabel}`}
        textLabel={`Add ${itemLabel}`}
        onClick={() => setOpened(true)}
      />
      <Modal opened={opened} onClose={() => setOpened(false)} title={`Adding ${itemLabel}`} size="sm">
        <RecordPicker
          view={pickerView}
          searchField="gramps_id"
          placeholder={pickerView.simpleSearch?.placeholder ?? "Search…"}
          buildExpr={pickerView.simpleSearch?.buildExpr}
          renderLabel={(item) => pickerResultLabel(pickerView.key, item)}
          onPick={handlePick}
          confirmWithButton
        />
      </Modal>
    </>
  );
}

/** Event has no forward reference to its participants at all -- only
 * Person/Family point *at* an Event via their own event_ref_list, so this
 * is a server-computed reverse lookup (profile=participants: "event
 * participants (people and families)"), the one piece plain backlinks
 * can't recover (generic backlinks don't carry which ref-list field or
 * role matched -- but this profile section does, participant by
 * participant). Editing a participant's role therefore has to patch the
 * *participant's own* event_ref_list, not this Event -- the reverse of
 * every other section's onEdit wiring, where `detail` already is the
 * record owning the ref. Add/remove (AddParticipantControl above,
 * detachRefListEntry below) follow the same reverse direction. */
export function ParticipantsSection({ detail, onNavigate, onRefetch }: SectionProps) {
  const participants = (detail.profile as any)?.participants;
  const people = (participants?.people as { person: { handle: string }; role: string }[] | undefined) ?? [];
  const families = (participants?.families as { family: { handle: string }; role: string }[] | undefined) ?? [];
  const [editing, setEditing] = useState<EditingParticipant | null>(null);
  const canEdit = hasPermissions("EditObject");
  if (people.length === 0 && families.length === 0 && !canEdit) return null;

  async function handleRemove(view: ViewConfig, participantHandle: string, obj: unknown) {
    const summary = summaryLine(view.key, obj) || `this ${view.key}`;
    if (!window.confirm(`Remove ${summary} from this event? This does not delete the ${view.key} itself.`)) return;
    const token = await getToken();
    await detachRefListEntry(token, view, participantHandle, "event_ref_list", detail.handle);
    onRefetch?.();
  }

  return (
    <SectionShell label={t("Participants")}>
      {people.map(({ person, role }) => (
        <RefRow
          key={person.handle}
          type="person"
          handle={person.handle}
          obj={person}
          refMeta={{ role }}
          onNavigate={onNavigate}
          onEdit={canEdit ? () => setEditing({ view: PERSON_VIEW, objectHandle: person.handle, role }) : undefined}
          onRemove={canEdit ? () => handleRemove(PERSON_VIEW, person.handle, person) : undefined}
        />
      ))}
      {families.map(({ family, role }) => (
        <RefRow
          key={family.handle}
          type="family"
          handle={family.handle}
          obj={family}
          refMeta={{ role }}
          onNavigate={onNavigate}
          onEdit={canEdit ? () => setEditing({ view: FAMILY_VIEW, objectHandle: family.handle, role }) : undefined}
          onRemove={canEdit ? () => handleRemove(FAMILY_VIEW, family.handle, family) : undefined}
        />
      ))}
      {canEdit && (
        <>
          <AddParticipantControl
            pickerView={PERSON_VIEW}
            eventHandle={detail.handle}
            itemLabel="a person"
            onAdded={() => onRefetch?.()}
          />
          <AddParticipantControl
            pickerView={FAMILY_VIEW}
            eventHandle={detail.handle}
            itemLabel="a family"
            onAdded={() => onRefetch?.()}
          />
        </>
      )}
      {editing && (
        <RefEditDialog
          opened
          onClose={() => setEditing(null)}
          refType="event"
          view={editing.view}
          objectHandle={editing.objectHandle}
          listField="event_ref_list"
          targetHandle={detail.handle}
          refMeta={{ role: editing.role }}
          onSaved={() => {
            setEditing(null);
            onRefetch?.();
          }}
        />
      )}
    </SectionShell>
  );
}
