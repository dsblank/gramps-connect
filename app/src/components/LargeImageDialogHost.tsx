import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Group, Modal, Radio, Stack, Text } from "@mantine/core";
import {
  formatFileSize,
  getLargeImageRequest,
  getRememberedResizeChoice,
  resolveLargeImageDialog,
  RESIZE_SIDES,
  scaledSize,
  subscribeLargeImageDialog,
  type ResizeChoice,
} from "../store/imageResize";
import { t } from "../i18n/i18n";

/** The single app-wide "this image is large -- resize it?" question, asked
 * by store/imageResize.ts's prepareImageUploads() before any upload a
 * person started themselves. Mounted once in App.tsx beside
 * ConfirmDialogHost, and above every other dialog for the same reason
 * (it's raised from inside edit dialogs, and the story editor). */
const LARGE_IMAGE_DIALOG_Z_INDEX = 2000;

export function LargeImageDialogHost() {
  const request = useSyncExternalStore(subscribeLargeImageDialog, getLargeImageRequest);
  const [choice, setChoice] = useState<string>("original");

  useEffect(() => {
    if (request) setChoice(String(getRememberedResizeChoice()));
  }, [request]);

  const images = request?.images ?? [];
  const single = images.length === 1 ? images[0] : null;
  const longest = Math.max(0, ...images.map((i) => Math.max(i.width, i.height)));
  // Only offer sizes that would actually shrink at least one image.
  const sides = RESIZE_SIDES.filter((side) => side < longest);
  const selected = choice === "original" || sides.includes(Number(choice) as (typeof sides)[number]) ? choice : "original";

  function sizeLabel(side: number): string {
    if (single) {
      const s = scaledSize(single.width, single.height, side);
      return `${s.width} × ${s.height} px`;
    }
    return t("{side} px on the longest side").replace("{side}", String(side));
  }

  function submit() {
    const answer: ResizeChoice = selected === "original" ? "original" : Number(selected);
    resolveLargeImageDialog(answer);
  }

  return (
    <Modal
      opened={request != null}
      onClose={() => resolveLargeImageDialog(null)}
      title={single ? t("Large image") : t("Large images")}
      size="md"
      zIndex={LARGE_IMAGE_DIALOG_Z_INDEX}
    >
      <Stack gap="sm">
        <Stack gap={2}>
          {images.map((image) => (
            <Text key={image.file.name + image.file.size} size="sm">
              <Text span fw={500}>{image.file.name}</Text>{" "}
              <Text span c="dimmed">
                {formatFileSize(image.file.size)}, {image.width} × {image.height} px
              </Text>
            </Text>
          ))}
        </Stack>
        <Text size="sm">
          {t(
            "A smaller copy is plenty for viewing on screen, in a story or as a map overlay, and loads much faster. Keep the original when fine detail matters, such as small print on a scanned document.",
          )}
        </Text>
        <Radio.Group value={selected} onChange={setChoice}>
          <Stack gap="xs">
            <Radio value="original" label={t("Keep original")} />
            {sides.map((side) => (
              <Radio key={side} value={String(side)} label={`${t("Resize to")} ${sizeLabel(side)}`} />
            ))}
          </Stack>
        </Radio.Group>
        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={() => resolveLargeImageDialog(null)}>
            {t("Cancel")}
          </Button>
          <Button onClick={submit}>{t("Upload")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
