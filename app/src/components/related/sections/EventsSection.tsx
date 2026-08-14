import { useState } from "react";
import { hasPermissions } from "../../../auth/auth";
import { zipRefs, type RawRef } from "../../../store/objectDetail";
import { RefEditDialog } from "../RefEditDialog";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** EventBase.event_ref_list -- shared verbatim by Person and Family (both
 * mix in EventBase), each ref carrying its own role (Primary/Witness/...). */
export function EventsSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipRefs(detail.event_ref_list, detail.extended?.events);
  const [editingRef, setEditingRef] = useState<RawRef | null>(null);
  const canEdit = hasPermissions("EditObject");
  if (rows.length === 0) return null;
  return (
    <SectionShell label="Events">
      {rows.map(({ ref, target }) => (
        <RefRow
          key={ref.ref}
          type="event"
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
          refType="event"
          view={view}
          objectHandle={detail.handle}
          listField="event_ref_list"
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
