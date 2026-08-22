import { getToken, hasPermissions } from "../../../auth/auth";
import { detachRefListEntry } from "../../../store/refListApi";
import { CITATION_VIEW } from "../../../store/views";
import { AttachControl } from "../AttachControl";
import { summaryLine } from "../summary";
import { SectionShell, RefRow, zipHandles } from "./shared";
import type { SectionProps } from "../types";
import { t } from "../../../i18n/i18n";

/** CitationBase.citation_list -- a plain handle list (no per-item ref
 * metadata; a citation reference is just "this object cites that citation",
 * nothing more), present on nearly every object type. */
export function CitationsSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipHandles(detail.citation_list, detail.extended?.citations);
  // See NotesSection.tsx's identical comment -- this live attach/detach is a
  // quicker path to citation_list than the edit dialog, not the only one.
  const canAttach = hasPermissions("EditObject");
  if (rows.length === 0 && !canAttach) return null;

  async function handleRemove(handle: string, target: unknown) {
    const summary = summaryLine("citation", target) || "this citation";
    if (!window.confirm(`Remove ${summary} from this ${view.key}? This does not delete the citation itself.`)) return;
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "citation_list", handle);
    onRefetch?.();
  }

  return (
    <SectionShell label={t("Citations")}>
      {rows.map(({ handle, target }) => (
        <RefRow
          key={handle}
          type="citation"
          handle={handle}
          obj={target}
          onNavigate={onNavigate}
          onRemove={canAttach ? () => handleRemove(handle, target) : undefined}
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
