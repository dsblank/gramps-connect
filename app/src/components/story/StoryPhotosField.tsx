// A story slide's photos, laid out like the story package's PhotosField:
// add them (picked from the tree's media, or uploaded as new media),
// reorder and remove them. Each is a reference to a Media object, so its
// caption and description stay the tree's own.
import { useState } from "react";
import { ActionIcon, Box, Button, FileButton, Group, Loader, Stack, Text, Tooltip } from "@mantine/core";
import { getToken } from "../../auth/auth";
import type { QueryItem } from "../../store/api";
import { uploadMediaFile } from "../../store/jobsApi";
import { MEDIA_VIEW } from "../../store/views";
import { pickerResultLabel } from "../RefPickerField";
import { RecordPicker } from "../RecordPicker";
import { MediaThumbnail } from "../related/MediaThumbnail";
import { t } from "../../i18n/i18n";
import { storyWords } from "./storyStrings";

/** What the story editor shows for a referenced event or photo: its label,
 * and for a photo its type (for its thumbnail). */
export interface RefInfo {
  label: string;
  mime?: string;
}

export function refInfo(type: "event" | "media", item: QueryItem): RefInfo {
  return { label: pickerResultLabel(type, item), mime: typeof item.mime === "string" ? item.mime : undefined };
}

export function StoryPhotosField({ photos, info, onChange, onAdd, onPicked }: {
  /** Media handles, in order. */
  photos: string[];
  info: Record<string, RefInfo>;
  /** Reordered or removed. */
  onChange: (photos: string[]) => void;
  /** Photos to add at the end, once picked or uploaded -- an upload ends
   * after other changes may have been made, so the editor adds them to
   * the slide as it is by then. */
  onAdd: (handles: string[]) => void;
  /** A photo picked from the tree, so its label is known straight away. */
  onPicked: (item: QueryItem) => void;
}) {
  const { editor: s, say } = storyWords();
  const [searching, setSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const move = (from: number, to: number) => {
    const next = [...photos];
    const [photo] = next.splice(from, 1);
    next.splice(to, 0, photo);
    onChange(next);
  };

  // Each file becomes a Media object in the tree as soon as it's uploaded
  // (as in MediaListField): only putting it on the slide waits for Save.
  async function upload(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    const handles: string[] = [];
    try {
      const token = await getToken();
      for (const file of files) handles.push(await uploadMediaFile(token, file));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      if (handles.length) onAdd(handles);
    }
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Text size="sm" fw={500}>{s.photos}</Text>
        <Group gap="xs">
          {uploading && <Loader size="xs" />}
          <Button variant="default" size="xs" onClick={() => setSearching((open) => !open)}>{say("Select existing…")}</Button>
          <FileButton onChange={(files) => void upload(files)} accept="image/*" multiple>
            {(props) => <Button variant="default" size="xs" disabled={uploading} {...props}>+ {say("Upload photo")}</Button>}
          </FileButton>
        </Group>
      </Group>
      {searching && (
        <RecordPicker
          view={MEDIA_VIEW}
          searchField="desc"
          buildExpr={MEDIA_VIEW.simpleSearch?.buildExpr}
          renderLabel={(item) => pickerResultLabel("media", item)}
          placeholder={MEDIA_VIEW.simpleSearch?.placeholder ?? t("Search…")}
          onPick={(item) => {
            setSearching(false);
            onPicked(item);
            onAdd([item.handle]);
          }}
        />
      )}
      {error && <Text size="xs" c="red" role="alert">{error}</Text>}
      {photos.length === 0 && (
        <Text size="xs" c="dimmed">{say("No photos yet. A slide can show several, one after another.")}</Text>
      )}
      {photos.map((handle, i) => {
        const photo = info[handle];
        const notImage = photo?.mime !== undefined && !photo.mime.startsWith("image/");
        return (
          <Group key={handle} gap="sm" wrap="nowrap">
            <Box
              w={64} h={64}
              style={{ flex: "none", borderRadius: 6, overflow: "hidden", background: "var(--mantine-color-default-hover)" }}
            >
              {photo && <MediaThumbnail handle={handle} mime={photo.mime} size={64} />}
            </Box>
            <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" truncate dir="auto">{photo?.label ?? handle}</Text>
              {notImage && <Text size="xs" c="dimmed">{say("Not shown: only images appear on a slide.")}</Text>}
            </Stack>
            <Group gap={4} wrap="nowrap">
              <Tooltip label={s.movePhotoUp}>
                <ActionIcon size="sm" variant="default" aria-label={s.movePhotoUp} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</ActionIcon>
              </Tooltip>
              <Tooltip label={s.movePhotoDown}>
                <ActionIcon size="sm" variant="default" aria-label={s.movePhotoDown} disabled={i === photos.length - 1} onClick={() => move(i, i + 1)}>↓</ActionIcon>
              </Tooltip>
              <Button variant="subtle" size="compact-xs" color="red" onClick={() => onChange(photos.filter((_, j) => j !== i))}>
                {s.removePhoto}
              </Button>
            </Group>
          </Group>
        );
      })}
    </Stack>
  );
}
