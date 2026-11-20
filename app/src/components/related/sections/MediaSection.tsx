import { useState } from "react";
import { getToken, hasPermissions } from "../../../auth/auth";
import { confirmDialog } from "../../../store/confirmDialog";
import { zipRefs } from "../../../store/objectDetail";
import { notifications } from "@mantine/notifications";
import { Text } from "@mantine/core";
import { attachRefListEntries, detachRefListEntry, moveRefListEntry, patchRefListEntry } from "../../../store/refListApi";
import { CircleGlyphButton } from "../../CircleGlyphButton";
import { addedFilesLabel, openFilePicker, uploadMediaFiles } from "../../../store/addMedia";
import { getViewStore } from "../../../store/registry";
import { MEDIA_VIEW } from "../../../store/views";
import { isOverlay } from "../../../store/mapOverlays";
import { useOverlayTagHandle } from "../../../hooks/useOverlayTagHandle";
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
 * generalizes to media_list's ref-struct shape with no changes needed.
 *
 * Order matters: the first entry is the record's own picture (its
 * thumbnail, a blog post's header image), so with more than one row each
 * can be moved up/down or straight to the top (★). Each move is one PUT
 * (moveRefListEntry), so one undoable transaction, and keeps the whole
 * MediaRef (region, citations) rather than detaching and re-attaching.
 * Rows carry their real media_list index since a place's overlays are
 * filtered out of the visible list. */
export function MediaSection({ view, detail, onNavigate, onRefetch }: SectionProps) {
  // A Place's own KML overlays get their own dedicated MapOverlaysSection.tsx
  // instead -- filtered out here so a place's attached map overlay doesn't
  // also show up a second time in this plain gallery (where it'd render as
  // a broken/generic thumbnail anyway, since a KML file isn't an image).
  // Every other type that carries a media_list has no such section, so this
  // filter is a no-op for them.
  // A place's overlays have their own section (MapOverlaysSection.tsx);
  // the map files they were made from stay here, as ordinary media.
  const overlayTag = useOverlayTagHandle() ?? null;
  const rows = zipRefs<{ mime?: string; tag_list?: string[] }>(detail.media_list, detail.extended?.media)
    .map((row, index) => ({ ...row, index }))
    .filter(({ target }) => view.key !== "place" || !isOverlay(target, overlayTag));
  const canAttach = hasPermissions("EditObject");
  const [moving, setMoving] = useState(false);
  const [regionTarget, setRegionTarget] = useState<{ handle: string; rect?: number[] | null } | null>(null);
  if (rows.length === 0 && !canAttach) return null;

  async function handleRemove(handle: string, target: { mime?: string } | undefined) {
    const summary = summaryLine("media", target) || "this media item";
    if (!(await confirmDialog(`Remove ${summary} from this ${view.key}? This does not delete the media item itself.`))) return;
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "media_list", handle);
    onRefetch?.();
  }

  async function handleMove(from: number, to: number, handle: string) {
    if (moving) return;
    setMoving(true);
    try {
      const token = await getToken();
      await moveRefListEntry(token, view, detail.handle, "media_list", from, to, handle);
      onRefetch?.();
    } catch (err) {
      notifications.show({
        color: "red",
        title: t("Couldn't change the order of the media"),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setMoving(false);
    }
  }

  async function handleSaveRegion(handle: string, rect: number[] | null) {
    const token = await getToken();
    await patchRefListEntry(token, view, detail.handle, "media_list", handle, { rect });
    onRefetch?.();
  }

  // "+" > Upload files: each file becomes a new Media object (its own
  // upload request), then all of them are linked here in one update.
  async function uploadAndAttach(files: File[]) {
    const uploaded = await uploadMediaFiles(files);
    if (uploaded.length === 0) return;
    getViewStore("media").requeryDebounced();
    const label = addedFilesLabel(uploaded.length);
    try {
      const token = await getToken();
      await attachRefListEntries(
        token, view, detail.handle, "media_list", uploaded.map((ref) => ({ _class: "MediaRef", ref })),
      );
      notifications.show({ color: "green", title: `${label} added`, message: t("Added here and to the Media list") });
    } catch (err: any) {
      notifications.show({
        color: "red",
        autoClose: false,
        title: `${label} uploaded, but couldn't add ${uploaded.length > 1 ? "them" : "it"} here`,
        message: `${err.message ?? String(err)}. ${t("Find it in the Media list and use + to add it here.")}`,
      });
    }
    onRefetch?.();
  }

  return (
    <SectionShell
      label={t("Media")}
      action={canAttach && (
        <AttachControl
          targetView={view}
          targetHandle={detail.handle}
          pickerView={MEDIA_VIEW}
          listField="media_list"
          buildEntry={(handle) => ({ _class: "MediaRef", ref: handle })}
          itemLabel="media"
          createLabel="media"
          createButtonLabel={t("Upload files")}
          onCreateNew={hasPermissions("AddObject") ? () => openFilePicker((files) => void uploadAndAttach(files)) : undefined}
          onAttached={() => onRefetch?.()}
        />
      )}
    >
      {rows.map(({ ref, target, index }, i) => (
        <RefRow
          key={`${index}-${ref.ref}`}
          type="media"
          handle={ref.ref}
          obj={target}
          refMeta={ref}
          thumbnail={<MediaThumbnail handle={ref.ref} mime={target?.mime} size={40} rect={ref.rect} zoomable />}
          onNavigate={onNavigate}
          extra={canAttach && rows.length > 1 && (
            <>
              {i > 0 && (
                <CircleGlyphButton
                  glyph="★"
                  label={t("Move to the top, so it's the picture shown for this record")}
                  size={16}
                  onClick={() => handleMove(index, 0, ref.ref)}
                />
              )}
              {i > 0 && (
                <CircleGlyphButton
                  glyph="↑"
                  label={t("Move up")}
                  size={16}
                  onClick={() => handleMove(index, rows[i - 1].index, ref.ref)}
                />
              )}
              {i < rows.length - 1 && (
                <CircleGlyphButton
                  glyph="↓"
                  label={t("Move down")}
                  size={16}
                  onClick={() => handleMove(index, rows[i + 1].index, ref.ref)}
                />
              )}
            </>
          )}
          onEditRegion={canAttach && target?.mime?.startsWith("image/")
            ? () => setRegionTarget({ handle: ref.ref, rect: ref.rect })
            : undefined}
          onRemove={canAttach ? () => handleRemove(ref.ref, target) : undefined}
        />
      ))}
      {rows.length > 1 && canAttach && (
        <Text size="xs" c="dimmed">
          {t("The first one is the picture shown for this record.")}
        </Text>
      )}
      {regionTarget && (
        <MediaRegionDialog
          opened
          handle={regionTarget.handle}
          initialRect={regionTarget.rect}
          onClose={() => setRegionTarget(null)}
          onSave={(rect) => handleSaveRegion(regionTarget.handle, rect)}
        />
      )}
    </SectionShell>
  );
}
