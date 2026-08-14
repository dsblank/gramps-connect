import { getToken, hasPermissions } from "../../../auth/auth";
import { detachRefListEntry } from "../../../store/refListApi";
import { CITATION_VIEW } from "../../../store/views";
import { AttachControl } from "../AttachControl";
import { SectionShell, RefRow, zipHandles } from "./shared";
import type { SectionProps } from "../types";

/** CitationBase.citation_list -- a plain handle list (no per-item ref
 * metadata; a citation reference is just "this object cites that citation",
 * nothing more), present on nearly every object type. */
export function CitationsSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipHandles(detail.citation_list, detail.extended?.citations);
  const canAttach = hasPermissions("EditObject");
  if (rows.length === 0 && !canAttach) return null;

  async function handleRemove(handle: string) {
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "citation_list", handle);
    onRefetch?.();
  }

  return (
    <SectionShell label="Citations">
      {rows.map(({ handle, target }) => (
        <RefRow
          key={handle}
          type="citation"
          handle={handle}
          obj={target}
          onNavigate={onNavigate}
          onRemove={canAttach ? () => handleRemove(handle) : undefined}
        />
      ))}
      {canAttach && (
        <AttachControl
          targetView={view}
          targetHandle={detail.handle}
          pickerView={CITATION_VIEW}
          listField="citation_list"
          itemLabel="a citation"
          onAttached={() => onRefetch?.()}
        />
      )}
    </SectionShell>
  );
}
