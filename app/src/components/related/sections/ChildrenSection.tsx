import { zipRefs } from "../../../store/objectDetail";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Family.child_ref_list -- each child carries its own frel/mrel (relation
 * to father/mother: Birth/Adopted/Step/Foster/...), the piece the old
 * PersonDetail.tsx discarded entirely. */
export function ChildrenSection({ detail, onNavigate }: SectionProps) {
  const rows = zipRefs(detail.child_ref_list, detail.extended?.children);
  if (rows.length === 0) return null;
  return (
    <SectionShell label="Children" count={rows.length} defaultOpen>
      {rows.map(({ ref, target }) => (
        <RefRow key={ref.ref} type="person" handle={ref.ref} obj={target} refMeta={ref} onNavigate={onNavigate} />
      ))}
    </SectionShell>
  );
}
