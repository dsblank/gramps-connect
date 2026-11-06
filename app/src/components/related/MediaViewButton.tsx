import { useState } from "react";
import { Group } from "@mantine/core";
import type { ObjectDetail } from "../../store/objectDetail";
import { previewKindForMime } from "./mediaPreviewKind";
import { MediaPreviewDialog } from "./MediaPreviewDialog";
import { ViewButton } from "./ViewButton";
import { MediaDownloadButton } from "./MediaDownloadButton";
import { mediaDownloadName } from "../../store/mediaDownload";
import { t } from "../../i18n/i18n";

/** A Media/Output row's own "view it in the browser" button, for every
 * mime type that isn't already viewable via MediaThumbnail.tsx's zoomable
 * click (images) -- PDF, video, audio, HTML/JSON/plain-text reports,
 * GEDCOM/KML/XML exports, etc. (see mediaPreviewKind.ts). Renders nothing
 * for a mime this app can't render anywhere in the browser (a zipped
 * export, a binary GEDCOM-adjacent format, ...) -- Download stays the only
 * option for those, same as before this button existed.
 *
 * Same row as VisualButtons.tsx's Map/Timeline/Tree ("look at this record
 * a different way, right now"), not History/Topic's muted gray -- viewing
 * the file itself is exactly that, not a secondary/muted action, so this
 * deliberately leaves ViewButton's `color` unset. */
export function MediaViewButton({ detail, withDownload = false }: { detail: ObjectDetail; withDownload?: boolean }) {
  const [opened, setOpened] = useState(false);
  const kind = previewKindForMime(detail.mime as string | undefined);
  if (!kind && !withDownload) return null;
  return (
    <>
      {/* withDownload (Media rows, not Output -- see MediaDownloadButton.tsx)
          puts Download on this same row, so View and Download sit together
          and a non-previewable file still gets its Download. */}
      <Group gap="xs">
        {kind && <ViewButton label={t("View")} onClick={() => setOpened(true)} />}
        {withDownload && <MediaDownloadButton detail={detail} />}
      </Group>
      {opened && kind && (
        <MediaPreviewDialog
          opened
          onClose={() => setOpened(false)}
          handle={detail.handle}
          kind={kind}
          fileName={mediaDownloadName(detail)}
        />
      )}
    </>
  );
}
