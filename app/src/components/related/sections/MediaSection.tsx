import { useState } from "react";
import { getToken, hasPermissions } from "../../../auth/auth";
import { zipRefs } from "../../../store/objectDetail";
import { detachRefListEntry, patchRefListEntry } from "../../../store/refListApi";
import { MEDIA_VIEW } from "../../../store/views";
import { AttachControl } from "../AttachControl";
import { MediaRegionDialog } from "../MediaRegionDialog";
import { MediaThumbnail } from "../MediaThumbnail";
import { summaryLine } from "../summary";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";
import { t } from "../../../i18n/i18n";

/** MediaBase.media_list -- under a "Media" SectionShell like every other
 * section. Attach/detach here (AttachControl.tsx, refListApi.ts) is a
 * quicker path to media_list than the edit dialog's own Media field, not
 * the only one -- same live-attach shape as Notes/Citations/Tags,
 * unconditional on type since every type that ever renders this section
 * (person/family/event/place/source/citation) is a real editable type;
 * Media/generated objects don't carry a media_list of their own, so this
 * section never renders for them regardless.
 *
 * The ✂ button (image refs only, permission-gated) opens
 * MediaRegionDialog.tsx to set this MediaRef's own crop rect -- the only
 * place in the app that can, since BacklinksSection.tsx's generic backlinks
 * (the Media object's own "Referenced by" list) carry no per-item ref
 * metadata to read or write. patchRefListEntry (refListApi.ts) already
 * generalizes to media_list's ref-struct shape with no changes needed. */
export function MediaSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  const rows = zipRefs<{ mime?: string }>(detail.media_list, detail.extended?.media);
  const canAttach = hasPermissions("EditObject");
  const [regionTarget, setRegionTarget] = useState<{ handle: string; rect?: number[] | null } | null>(null);
  if (rows.length === 0 && !canAttach) return null;

  async function handleRemove(handle: string, target: { mime?: string } | undefined) {
    const summary = summaryLine("media", target) || "this media item";
    if (!window.confirm(`Remove ${summary} from this ${view.key}? This does not delete the media item itself.`)) return;
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "media_list", handle);
    onRefetch?.();
  }

  async function handleSaveRegion(handle: string, rect: number[] | null) {
    const token = await getToken();
    await patchRefListEntry(token, view, detail.handle, "media_list", handle, { rect });
    onRefetch?.();
  }

  return (
    <SectionShell label={t("Media")}>
      {rows.map(({ ref, target }) => (
        <RefRow
          key={ref.ref}
          type="media"
          handle={ref.ref}
          obj={target}
          refMeta={ref}
          thumbnail={<MediaThumbnail handle={ref.ref} mime={target?.mime} size={40} rect={ref.rect} zoomable />}
          onNavigate={onNavigate}
          onEditRegion={canAttach && target?.mime?.startsWith("image/")
            ? () => setRegionTarget({ handle: ref.ref, rect: ref.rect })
            : undefined}
          onRemove={canAttach ? () => handleRemove(ref.ref, target) : undefined}
        />
      ))}
      {regionTarget && (
        <MediaRegionDialog
          opened
          handle={regionTarget.handle}
          initialRect={regionTarget.rect}
          onClose={() => setRegionTarget(null)}
          onSave={(rect) => handleSaveRegion(regionTarget.handle, rect)}
        />
      )}
      {canAttach && (
        <AttachControl
          targetView={view}
          targetHandle={detail.handle}
          pickerView={MEDIA_VIEW}
          listField="media_list"
          buildEntry={(handle) => ({ _class: "MediaRef", ref: handle })}
          itemLabel="media"
          onAttached={() => onRefetch?.()}
        />
      )}
    </SectionShell>
  );
}
