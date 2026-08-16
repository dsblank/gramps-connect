import { useState } from "react";
import { hasPermissions } from "../../../auth/auth";
import { zipRefs, type RawRef } from "../../../store/objectDetail";
import { RefEditDialog } from "../RefEditDialog";
import { EventCreateDialog } from "../EventCreateDialog";
import { CircleGlyphButton } from "../../CircleGlyphButton";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** EventBase.event_ref_list -- shared verbatim by Person and Family (both
 * mix in EventBase), each ref carrying its own role (Primary/Witness/...).
 * Gained its own "+ New Event" (EventCreateDialog.tsx) alongside the
 * existing per-row edit-role icon -- unlike the other reference-list
 * sections' AttachControl, this creates a brand-new Event rather than
 * attaching an existing one (see EventCreateDialog.tsx's own doc comment).
 * Now renders even with zero rows when the viewer can create one (matches
 * NotesSection.tsx's `rows.length > 0 || canAttach` convention) and sits in
 * config.ts's `(+) Add` group rather than the edit-only one, since it's no
 * longer purely read-only. */
export function EventsSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipRefs(detail.event_ref_list, detail.extended?.events);
  const [editingRef, setEditingRef] = useState<RawRef | null>(null);
  const [creating, setCreating] = useState(false);
  const canEdit = hasPermissions("EditObject");
  if (rows.length === 0 && !canEdit) return null;
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
      {canEdit && (
        <CircleGlyphButton glyph="+" label="Add a new event" textLabel="Add a new event" onClick={() => setCreating(true)} />
      )}
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
      {creating && (
        <EventCreateDialog
          opened
          onClose={() => setCreating(false)}
          view={view}
          objectHandle={detail.handle}
          onSaved={() => {
            setCreating(false);
            onRefetch?.();
          }}
        />
      )}
    </SectionShell>
  );
}
