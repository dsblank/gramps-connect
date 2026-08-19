import { useState } from "react";
import { getToken, hasPermissions } from "../../../auth/auth";
import { zipRefs, type RawRef } from "../../../store/objectDetail";
import { detachRefListEntry } from "../../../store/refListApi";
import { PERSON_VIEW } from "../../../store/views";
import { AttachControl } from "../AttachControl";
import { RefEditDialog } from "../RefEditDialog";
import { summaryLine } from "../summary";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Family.child_ref_list -- each child carries its own frel/mrel (relation
 * to father/mother: Birth/Adopted/Step/Foster/...), the piece the old
 * PersonDetail.tsx discarded entirely. Attach (AttachControl,
 * refListApi.ts) defaults a new child's frel/mrel to "Birth" -- the edit
 * icon below (already wired) is the fix-up path for anything else, same as
 * it always has been for an existing row. */
export function ChildrenSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipRefs(detail.child_ref_list, detail.extended?.children);
  const [editingRef, setEditingRef] = useState<RawRef | null>(null);
  const canEdit = hasPermissions("EditObject");
  if (rows.length === 0 && !canEdit) return null;

  async function handleRemove(handle: string, target: unknown) {
    const summary = summaryLine("person", target) || "this person";
    if (!window.confirm(`Remove ${summary} as a child from this family? This does not delete the person themselves.`)) return;
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "child_ref_list", handle);
    onRefetch?.();
  }

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
          onRemove={canEdit ? () => handleRemove(ref.ref, target) : undefined}
        />
      ))}
      {canEdit && (
        <AttachControl
          targetView={view}
          targetHandle={detail.handle}
          pickerView={PERSON_VIEW}
          listField="child_ref_list"
          buildEntry={(handle) => ({ _class: "ChildRef", ref: handle, frel: "Birth", mrel: "Birth" })}
          itemLabel="a child"
          onAttached={() => onRefetch?.()}
        />
      )}
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
