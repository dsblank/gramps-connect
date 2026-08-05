import { zipRefs } from "../../../store/objectDetail";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Person.person_ref_list -- associations to other people (godparent,
 * witness, ...), each carrying its own free-text `rel` description. */
export function AssociationsSection({ detail, onNavigate }: SectionProps) {
  const rows = zipRefs(detail.person_ref_list, detail.extended?.people);
  if (rows.length === 0) return null;
  return (
    <SectionShell label="Associations" count={rows.length} defaultOpen>
      {rows.map(({ ref, target }) => (
        <RefRow key={ref.ref} type="person" handle={ref.ref} obj={target} refMeta={ref} onNavigate={onNavigate} />
      ))}
    </SectionShell>
  );
}
