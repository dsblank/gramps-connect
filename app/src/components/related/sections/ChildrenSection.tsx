import { useState } from "react";
import { hasPermissions } from "../../../auth/auth";
import { zipRefs, type RawRef } from "../../../store/objectDetail";
import { RefEditDialog } from "../RefEditDialog";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Family.child_ref_list -- each child carries its own frel/mrel (relation
 * to father/mother: Birth/Adopted/Step/Foster/...), the piece the old
 * PersonDetail.tsx discarded entirely. */
export function ChildrenSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipRefs(detail.child_ref_list, detail.extended?.children);
  const [editingRef, setEditingRef] = useState<RawRef | null>(null);
  const canEdit = hasPermissions("EditObject");
  if (rows.length === 0) return null;
  return (
    <SectionShell label="Children">
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
          refType="child"
          view={view}
          objectHandle={detail.handle}
          listField="child_ref_list"
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
