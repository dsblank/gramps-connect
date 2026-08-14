import { Group, Text, UnstyledButton } from "@mantine/core";
import { hasPermissions } from "../../../auth/auth";
import { zipRefs } from "../../../store/objectDetail";
import { MEDIA_VIEW } from "../../../store/views";
import { AttachControl } from "../AttachControl";
import { summaryLine } from "../summary";
import { MediaThumbnail } from "../MediaThumbnail";
import { SectionShell } from "./shared";
import type { SectionProps } from "../types";

/** MediaBase.media_list -- under a "Media" SectionShell like every other
 * section, but its body is deliberately *not* an inline RefRow list the
 * way Notes/Citations are: a record can carry hundreds of attached photos,
 * and expanding that inline would mean hundreds of simultaneous thumbnail
 * requests (each its own auth-token-bearing <img>) just from selecting a
 * row. Instead, a single line (one thumbnail as a teaser, not the whole
 * set) that hands the whole list off to ReferenceDetail's gallery view in
 * the bottom pane -- browsing many photos gets the full-size grid
 * treatment there instead of a cramped inline list here.
 *
 * Attach-only (no per-item detach yet, unlike Notes/Citations/Tags): there's
 * no per-row list here to hang a Remove control off without restructuring
 * this into the very inline-list shape the doc comment above says this
 * section exists to avoid -- deferred, see EDITING-TODO.md. */
export function MediaSection({ view, type, detail, onViewGallery, onRefetch }: SectionProps) {
  const rows = zipRefs<{ mime?: string }>(detail.media_list, detail.extended?.media);
  const canAttach = hasPermissions("EditObject");
  if (rows.length === 0 && !canAttach) return null;

  const teaser = rows.find((r) => r.target?.mime?.startsWith("image/"));
  const label = `${summaryLine(type, detail) || "this"}: ${rows.length} media item${rows.length > 1 ? "s" : ""}`;

  let content = null;
  if (rows.length > 0 && !onViewGallery) {
    // No gallery destination available (the bottom pane's own nested
    // RelatedPanel isn't wired with one -- there's no third pane to hand
    // a gallery off to from there) -- a plain count rather than either
    // extreme (a dead link, or falling back to the inline flood this
    // section exists to avoid).
    content = <Text size="md" fw={600}>🖼 {rows.length} media item{rows.length > 1 ? "s" : ""}</Text>;
  } else if (rows.length > 0 && onViewGallery) {
    content = (
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

  return (
    <SectionShell label="Media">
      {content}
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
