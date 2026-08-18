import { zipRefs } from "../../../store/objectDetail";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** EventBase.event_ref_list -- shared verbatim by Person and Family (both
 * mix in EventBase), each ref carrying its own role (Primary/Witness/...).
 * Read-only: Person and Family now edit this list -- add, remove, and the
 * `role` an event is attached with -- only through their own edit dialog's
 * Events field (RefPickerField.tsx's EventsField). An existing entry's
 * `role` still isn't editable from there either, same MVP scope every
 * other list field's extra per-entry field already accepted -- fixing a
 * wrong role after the fact is still ParticipantsSection.tsx's own
 * &#9998;, viewed from the Event's own page (the reverse direction: editing
 * the *participant's* event_ref_list, not this record's). */
export function EventsSection({ detail, onNavigate }: SectionProps) {
  const rows = zipRefs(detail.event_ref_list, detail.extended?.events);
  if (rows.length === 0) return null;

  return (
    <SectionShell label="Events">
      {rows.map(({ ref, target }) => (
        <RefRow key={ref.ref} type="event" handle={ref.ref} obj={target} refMeta={ref} onNavigate={onNavigate} />
      ))}
    </SectionShell>
  );
}
