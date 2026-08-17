import { useState } from "react";
import { getToken, hasPermissions } from "../../../auth/auth";
import { zipRefs, type RawRef } from "../../../store/objectDetail";
import { detachRefListEntry } from "../../../store/refListApi";
import { CircleGlyphButton } from "../../CircleGlyphButton";
import { AssociationCreateDialog } from "../AssociationCreateDialog";
import { RefEditDialog } from "../RefEditDialog";
import { summaryLine } from "../summary";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Person.person_ref_list -- associations to other people (godparent,
 * witness, ...), each carrying its own free-text `rel` description. Add via
 * AssociationCreateDialog (a person picker plus that `rel` text, since
 * AttachControl's own dialog has no room for a second field); remove via
 * plain detachRefListEntry, same as Notes/Citations/Tags/Media. */
export function AssociationsSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipRefs(detail.person_ref_list, detail.extended?.people);
  const [editingRef, setEditingRef] = useState<RawRef | null>(null);
  const [adding, setAdding] = useState(false);
  const canEdit = hasPermissions("EditObject");
  if (rows.length === 0 && !canEdit) return null;

  async function handleRemove(handle: string, target: unknown) {
    const summary = summaryLine("person", target) || "this association";
    if (!window.confirm(`Remove the association with ${summary}? This does not delete the person themselves.`)) return;
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "person_ref_list", handle);
    onRefetch?.();
  }

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
          onRemove={canEdit ? () => handleRemove(ref.ref, target) : undefined}
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
      {canEdit && (
        <>
          <CircleGlyphButton glyph="+" label="Add an association" textLabel="Add an association" onClick={() => setAdding(true)} />
          <AssociationCreateDialog
            opened={adding}
            onClose={() => setAdding(false)}
            view={view}
            objectHandle={detail.handle}
            onSaved={() => {
              setAdding(false);
              onRefetch?.();
            }}
          />
        </>
      )}
    </SectionShell>
  );
}
