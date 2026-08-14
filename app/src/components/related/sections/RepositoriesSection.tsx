import { useState } from "react";
import { hasPermissions } from "../../../auth/auth";
import { zipRefs, type RawRef } from "../../../store/objectDetail";
import { RefEditDialog } from "../RefEditDialog";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** Source.reporef_list -- repositories this source is held at, each
 * carrying its own call_number/media_type (RepoRef, not a bare handle). */
export function RepositoriesSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipRefs(detail.reporef_list, detail.extended?.repositories);
  const [editingRef, setEditingRef] = useState<RawRef | null>(null);
  const canEdit = hasPermissions("EditObject");
  if (rows.length === 0) return null;
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
        />
      ))}
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
