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
import { t } from "../../../i18n/i18n";

/** Person.person_ref_list -- associations to other people (godparent,
 * witness, ...), each carrying its own free-text `rel` description.
 * person_ref_list only exists on Person (RELATED_CONFIG only ever lists
 * "associations" there). Add/remove live here (AttachControl,
 * refListApi.ts), same as every other list-with-metadata section -- a
 * newly attached association defaults `rel` to "". RefEditDialog's own
 * refType="person" case (already built, previously unused -- see its own
 * doc comment) is wired to the edit icon here to fill that in. */
export function AssociationsSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipRefs(detail.person_ref_list, detail.extended?.people);
  const [editingRef, setEditingRef] = useState<RawRef | null>(null);
  const canEdit = hasPermissions("EditObject");
  if (rows.length === 0 && !canEdit) return null;

  async function handleRemove(handle: string, target: unknown) {
    const summary = summaryLine("person", target) || "this person";
    if (!window.confirm(`Remove the association with ${summary}? This does not delete the person themselves.`)) return;
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "person_ref_list", handle);
    onRefetch?.();
  }

  return (
    <SectionShell label={t("Associations")}>
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
          listField="person_ref_list"
          buildEntry={(handle) => ({ _class: "PersonRef", ref: handle, rel: "" })}
          itemLabel="an association"
          onAttached={() => onRefetch?.()}
        />
      )}
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
