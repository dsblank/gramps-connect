import { useState } from "react";
import { hasPermissions } from "../../../auth/auth";
import { FAMILY_VIEW, PERSON_VIEW, type ViewConfig } from "../../../store/views";
import { RefEditDialog } from "../RefEditDialog";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

interface EditingParticipant {
  view: ViewConfig;
  objectHandle: string;
  role: string;
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
 * record owning the ref. */
export function ParticipantsSection({ detail, onNavigate, onRefetch }: SectionProps) {
  const participants = (detail.profile as any)?.participants;
  const people = (participants?.people as { person: { handle: string }; role: string }[] | undefined) ?? [];
  const families = (participants?.families as { family: { handle: string }; role: string }[] | undefined) ?? [];
  const [editing, setEditing] = useState<EditingParticipant | null>(null);
  const canEdit = hasPermissions("EditObject");
  if (people.length === 0 && families.length === 0) return null;
  return (
    <SectionShell label="Participants">
      {people.map(({ person, role }) => (
        <RefRow
          key={person.handle}
          type="person"
          handle={person.handle}
          obj={person}
          refMeta={{ role }}
          onNavigate={onNavigate}
          onEdit={canEdit ? () => setEditing({ view: PERSON_VIEW, objectHandle: person.handle, role }) : undefined}
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
        />
      ))}
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
