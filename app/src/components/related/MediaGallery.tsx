import { Group, ScrollArea, Stack, Title, UnstyledButton } from "@mantine/core";
import { MediaThumbnail } from "./MediaThumbnail";
import type { GalleryItem } from "./types";

/** The bottom pane's alternative to a single-object RelatedPanel -- what
 * MediaSection hands off to instead of expanding hundreds of thumbnails
 * inline (see its own doc comment). A grid rather than a list, since
 * browsing many photos at once is the whole point of landing here.
 * Clicking a photo promotes to it directly (same onPromote ReferenceDetail
 * already uses for a single-object sub-selection) -- there's no third pane
 * for a per-photo preview step. */
export function MediaGallery({ items, label, onPromote }: {
  items: GalleryItem[];
  label: string;
  onPromote: (type: string, handle: string) => void;
}) {
  return (
    <ScrollArea h="100%" type="auto">
      <Stack gap="md" p="md">
        <Title order={4}>{label}</Title>
        {/* Wraps naturally to the pane's width rather than a fixed column
            count that could overflow or leave awkward gaps at odd widths. */}
        <Group gap="sm">
          {items.map((item) => (
            <UnstyledButton key={item.handle} onClick={() => onPromote("media", item.handle)}>
              <MediaThumbnail handle={item.handle} mime={item.mime} size={110} />
            </UnstyledButton>
          ))}
        </Group>
      </Stack>
    </ScrollArea>
  );
}
