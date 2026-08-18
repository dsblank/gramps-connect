import { zipRefs } from "../../../store/objectDetail";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Person.person_ref_list -- associations to other people (godparent,
 * witness, ...), each carrying its own free-text `rel` description.
 * Read-only: person_ref_list only exists on Person (RELATED_CONFIG only
 * ever lists "associations" there), and Person edits this list -- add,
 * remove, and the `rel` an association is created with -- only through
 * PersonEditDialog.tsx's own Associations field now. An existing entry's
 * `rel` still isn't editable from there either, same MVP scope Family's
 * frel/mrel already accepted -- nothing outside the stacked dialog edits
 * this record at all anymore, full stop. */
export function AssociationsSection({ detail, onNavigate }: SectionProps) {
  const rows = zipRefs(detail.person_ref_list, detail.extended?.people);
  if (rows.length === 0) return null;

  return (
    <SectionShell label="Associations">
      {rows.map(({ ref, target }) => (
        <RefRow key={ref.ref} type="person" handle={ref.ref} obj={target} refMeta={ref} onNavigate={onNavigate} />
      ))}
    </SectionShell>
  );
}
