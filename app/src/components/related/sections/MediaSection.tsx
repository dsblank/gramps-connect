import { Group, Text, UnstyledButton } from "@mantine/core";
import { zipRefs } from "../../../store/objectDetail";
import { summaryLine } from "../summary";
import { MediaThumbnail } from "../MediaThumbnail";
import type { SectionProps } from "../types";

/** MediaBase.media_list -- deliberately *not* SectionShell + inline RefRows
 * the way every other section is: a record can carry hundreds of attached
 * photos, and expanding that inline would mean hundreds of simultaneous
 * thumbnail requests (each its own auth-token-bearing <img>) just from
 * selecting a row. Instead, a single always-visible line (one thumbnail as
 * a teaser, not the whole set) that hands the whole list off to
 * ReferenceDetail's gallery view in the bottom pane -- browsing many
 * photos gets the full-size grid treatment there instead of a cramped
 * inline list here. */
export function MediaSection({ type, detail, onViewGallery }: SectionProps) {
  const rows = zipRefs<{ mime?: string }>(detail.media_list, detail.extended?.media);
  if (rows.length === 0) return null;

  const teaser = rows.find((r) => r.target?.mime?.startsWith("image/"));
  const label = `${summaryLine(type, detail) || "this"}: ${rows.length} media item${rows.length > 1 ? "s" : ""}`;

  if (!onViewGallery) {
    // No gallery destination available (the bottom pane's own nested
    // RelatedPanel isn't wired with one -- there's no third pane to hand
    // a gallery off to from there) -- a plain count rather than either
    // extreme (a dead link, or falling back to the inline flood this
    // section exists to avoid).
    return <Text size="md" fw={600}>🖼 {rows.length} media item{rows.length > 1 ? "s" : ""}</Text>;
  }

  return (
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
  );
}
