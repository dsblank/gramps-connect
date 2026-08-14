import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Event has no forward reference to its participants at all -- only
 * Person/Family point *at* an Event via their own event_ref_list, so this
 * is a server-computed reverse lookup (profile=participants: "event
 * participants (people and families)"), the one piece plain backlinks
 * can't recover (generic backlinks don't carry which ref-list field or
 * role matched -- but this profile section does, participant by
 * participant). */
export function ParticipantsSection({ detail, onNavigate }: SectionProps) {
  const participants = (detail.profile as any)?.participants;
  const people = (participants?.people as { person: { handle: string }; role: string }[] | undefined) ?? [];
  const families = (participants?.families as { family: { handle: string }; role: string }[] | undefined) ?? [];
  if (people.length === 0 && families.length === 0) return null;
  return (
    <SectionShell label="Participants">
      {people.map(({ person, role }) => (
        <RefRow key={person.handle} type="person" handle={person.handle} obj={person} refMeta={{ role }} onNavigate={onNavigate} />
      ))}
      {families.map(({ family, role }) => (
        <RefRow key={family.handle} type="family" handle={family.handle} obj={family} refMeta={{ role }} onNavigate={onNavigate} />
      ))}
    </SectionShell>
  );
}
