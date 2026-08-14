import { useState } from "react";
import { hasPermissions } from "../../../auth/auth";
import { zipRefs, type RawRef } from "../../../store/objectDetail";
import { RefEditDialog } from "../RefEditDialog";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Person.person_ref_list -- associations to other people (godparent,
 * witness, ...), each carrying its own free-text `rel` description. */
export function AssociationsSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipRefs(detail.person_ref_list, detail.extended?.people);
  const [editingRef, setEditingRef] = useState<RawRef | null>(null);
  const canEdit = hasPermissions("EditObject");
  if (rows.length === 0) return null;
  return (
    <SectionShell label="Associations">
      {rows.map(({ ref, target }) => (
        <RefRow
          key={ref.ref}
          type="person"
          handle={ref.ref}
          obj={target}
          refMeta={ref}
          onNavigate={onNavigate}
          onEdit={canEdit ? () => setEditingRef(ref) : undefined}
        />
      ))}
      {editingRef && (
        <RefEditDialog
          opened
          onClose={() => setEditingRef(null)}
          refType="person"
          view={view}
          objectHandle={detail.handle}
          listField="person_ref_list"
          targetHandle={editingRef.ref}
          refMeta={editingRef}
          onSaved={() => {
            setEditingRef(null);
            onRefetch?.();
          }}
        />
      )}
    </SectionShell>
  );
}
