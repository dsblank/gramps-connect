import { Group, Text, UnstyledButton } from "@mantine/core";
import { zipRefs } from "../../../store/objectDetail";
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
 * bearing <img> requests. Read-only: every type with a "Media" section of
 * its own (person/family/event/place/source/citation -- see
 * RELATED_CONFIG) is now editable, and edits this list only through its
 * own edit dialog's Media field (MediaListField, phases 3-4) -- unlike
 * Notes/Citations/Tags, there's no type left where this section is the
 * *only* way to manage it (Media/generated objects don't carry a
 * media_list of their own to begin with, so this section never even
 * renders for them). */
export function MediaSection({ type, detail, onNavigate, onViewGallery }: SectionProps) {
  const rows = zipRefs<{ mime?: string }>(detail.media_list, detail.extended?.media);
  if (rows.length === 0) return null;

  const teaser = rows.find((r) => r.target?.mime?.startsWith("image/"));
  const label = `${summaryLine(type, detail) || "this"}: ${rows.length} media item${rows.length > 1 ? "s" : ""}`;

  return (
    <SectionShell label="Media">
      {onViewGallery && (
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
        <RefRow key={ref.ref} type="media" handle={ref.ref} obj={target} onNavigate={onNavigate} />
      ))}
    </SectionShell>
  );
}
