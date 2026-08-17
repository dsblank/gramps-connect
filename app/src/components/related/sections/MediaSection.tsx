import { Group, Text, UnstyledButton } from "@mantine/core";
import { getToken, hasPermissions } from "../../../auth/auth";
import { zipRefs } from "../../../store/objectDetail";
import { MEDIA_VIEW } from "../../../store/views";
import { detachRefListEntry } from "../../../store/refListApi";
import { AttachControl } from "../AttachControl";
import { summaryLine } from "../summary";
import { MediaThumbnail } from "../MediaThumbnail";
import { SectionShell, RefRow } from "./shared";
import type { SectionProps } from "../types";

/** MediaBase.media_list -- under a "Media" SectionShell like every other
 * section. The optional visual teaser/gallery link (one thumbnail plus a
 * "View N items" hand-off to ReferenceDetail's grid, see MediaGallery.tsx)
 * stays opt-in and thumbnail-light for the same reason as before: a record
 * can carry hundreds of attached photos, and loading all of them just from
 * viewing this section would mean hundreds of simultaneous auth-token-
 * bearing <img> requests. But the list itself is now a plain RefRow list
 * underneath, same shape as Notes/Citations/Tags -- text labels only, no
 * per-row thumbnail, so it costs nothing extra to render even at that size,
 * and it's what makes per-item detach possible (detachRefListEntry already
 * handles MediaRef-wrapped entries -- see its own doc comment -- so no
 * store-layer change was needed here, just wiring RefRow's onRemove). */
export function MediaSection({ view, type, detail, onNavigate, onViewGallery, onRefetch }: SectionProps) {
  const rows = zipRefs<{ mime?: string }>(detail.media_list, detail.extended?.media);
  const canAttach = hasPermissions("EditObject");
  if (rows.length === 0 && !canAttach) return null;

  const teaser = rows.find((r) => r.target?.mime?.startsWith("image/"));
  const label = `${summaryLine(type, detail) || "this"}: ${rows.length} media item${rows.length > 1 ? "s" : ""}`;

  async function handleRemove(handle: string, target: unknown) {
    const summary = summaryLine("media", target) || "this media item";
    if (!window.confirm(`Remove ${summary} from this ${view.key}? This does not delete the media item itself.`)) return;
    const token = await getToken();
    await detachRefListEntry(token, view, detail.handle, "media_list", handle);
    onRefetch?.();
  }

  return (
    <SectionShell label="Media">
      {rows.length > 0 && onViewGallery && (
        <UnstyledButton
          onClick={() => onViewGallery(rows.map((r) => ({ handle: r.ref.ref, mime: r.target?.mime })), label)}
          style={{ display: "block" }}
        >
          <Group gap="sm" wrap="nowrap">
            {teaser && <MediaThumbnail handle={teaser.ref.ref} mime={teaser.target?.mime} size={40} />}
            <Text size="md" fw={600} c="var(--mantine-color-anchor)">
              🖼 View {rows.length} media item{rows.length > 1 ? "s" : ""} →
            </Text>
          </Group>
        </UnstyledButton>
      )}
      {rows.map(({ ref, target }) => (
        <RefRow
          key={ref.ref}
          type="media"
          handle={ref.ref}
          obj={target}
          onNavigate={onNavigate}
          onRemove={canAttach ? () => handleRemove(ref.ref, target) : undefined}
        />
      ))}
      {canAttach && (
        <AttachControl
          targetView={view}
          targetHandle={detail.handle}
          pickerView={MEDIA_VIEW}
          listField="media_list"
          wrapRef
          itemLabel="media"
          onAttached={() => onRefetch?.()}
        />
      )}
    </SectionShell>
  );
}
