import { useState } from "react";
import { getToken, hasPermissions } from "../../../auth/auth";
import { confirmDialog } from "../../../store/confirmDialog";
import { zipRefs, type RawRef } from "../../../store/objectDetail";
import { notifications } from "@mantine/notifications";
import { detachRefListEntry, moveRefListEntry } from "../../../store/refListApi";
import { CircleGlyphButton } from "../../CircleGlyphButton";
import { PERSON_VIEW } from "../../../store/views";
import { AttachControl } from "../AttachControl";
import { RefEditDialog } from "../RefEditDialog";
import { summaryLine } from "../summary";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";
import { t } from "../../../i18n/i18n";

/** Family.child_ref_list -- each child carries its own frel/mrel (relation
 * to father/mother: Birth/Adopted/Step/Foster/...), the piece the old
 * PersonDetail.tsx discarded entirely. Attach (AttachControl,
 * refListApi.ts) defaults a new child's frel/mrel to "Birth" -- the edit
 * icon below (already wired) is the fix-up path for anything else, same as
 * it always has been for an existing row.
 *
 * With more than one child, ↑/↓ reorder them (Gramps' own Children tab
 * buttons) -- one PUT per move via moveRefListEntry, so each is one
 * undoable transaction and keeps the ChildRef's frel/mrel/citations. */
export function ChildrenSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipRefs(detail.child_ref_list, detail.extended?.children);
  const [editingRef, setEditingRef] = useState<RawRef | null>(null);
  const canEdit = hasPermissions("EditObject");
  const [moving, setMoving] = useState(false);
  if (rows.length === 0 && !canEdit) return null;

  async function handleRemove(handle: string, target: unknown) {
    const summary = summaryLine("person", target) || "this person";
    if (!(await confirmDialog(`Remove ${summary} as a child from this family? This does not delete the person themselves.`))) return;
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "child_ref_list", handle);
    onRefetch?.();
  }

  async function handleMove(from: number, to: number, handle: string) {
    if (moving) return;
    setMoving(true);
    try {
      const token = await getToken();
      await moveRefListEntry(token, view, detail.handle, "child_ref_list", from, to, handle);
      onRefetch?.();
    } catch (err) {
      notifications.show({
        color: "red",
        title: t("Couldn't change the order of the children"),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setMoving(false);
    }
  }

  return (
    <SectionShell
      label={t("Children")}
      action={canEdit && (
        <AttachControl
          targetView={view}
          targetHandle={detail.handle}
          pickerView={PERSON_VIEW}
          listField="child_ref_list"
          buildEntry={(handle) => ({ _class: "ChildRef", ref: handle, frel: "Birth", mrel: "Birth" })}
          itemLabel="a child"
          createType="person"
          onAttached={() => onRefetch?.()}
        />
      )}
    >
      {rows.map(({ ref, target }, i) => (
        <RefRow
          key={`${i}-${ref.ref}`}
          type="person"
          handle={ref.ref}
          obj={target}
          refMeta={ref}
          onNavigate={onNavigate}
          extra={canEdit && rows.length > 1 && (
            <>
              {i > 0 && (
                <CircleGlyphButton glyph="↑" label={t("Move up")} size={16} onClick={() => handleMove(i, i - 1, ref.ref)} />
              )}
              {i < rows.length - 1 && (
                <CircleGlyphButton glyph="↓" label={t("Move down")} size={16} onClick={() => handleMove(i, i + 1, ref.ref)} />
              )}
            </>
          )}
          onEdit={canEdit ? () => setEditingRef(ref) : undefined}
          onRemove={canEdit ? () => handleRemove(ref.ref, target) : undefined}
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
