import { useState } from "react";
import { getToken, hasPermissions } from "../../../auth/auth";
import { zipRefs, type RawRef } from "../../../store/objectDetail";
import { detachRefListEntry } from "../../../store/refListApi";
import { REPOSITORY_VIEW } from "../../../store/views";
import { AttachControl } from "../AttachControl";
import { RefEditDialog } from "../RefEditDialog";
import { summaryLine } from "../summary";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Source.reporef_list -- repositories this source is held at, each
 * carrying its own call_number/media_type (RepoRef, not a bare handle).
 * Attach (AttachControl, refListApi.ts) defaults both to "" -- the edit
 * icon below (already wired) is the fix-up path for anything else, same as
 * it always has been for an existing row. */
export function RepositoriesSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipRefs(detail.reporef_list, detail.extended?.repositories);
  const [editingRef, setEditingRef] = useState<RawRef | null>(null);
  const canEdit = hasPermissions("EditObject");
  if (rows.length === 0 && !canEdit) return null;

  async function handleRemove(handle: string, target: unknown) {
    const summary = summaryLine("repository", target) || "this repository";
    if (!window.confirm(`Remove ${summary} from this source? This does not delete the repository itself.`)) return;
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "reporef_list", handle);
    onRefetch?.();
  }

  return (
    <SectionShell label="Repositories">
      {rows.map(({ ref, target }) => (
        <RefRow
          key={ref.ref}
          type="repository"
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
          pickerView={REPOSITORY_VIEW}
          listField="reporef_list"
          buildEntry={(handle) => ({ _class: "RepoRef", ref: handle, call_number: "", media_type: "" })}
          itemLabel="a repository"
          onAttached={() => onRefetch?.()}
        />
      )}
      {editingRef && (
        <RefEditDialog
          opened
          onClose={() => setEditingRef(null)}
          refType="repo"
          view={view}
          objectHandle={detail.handle}
          listField="reporef_list"
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
