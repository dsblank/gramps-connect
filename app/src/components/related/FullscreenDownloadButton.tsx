import { useState } from "react";
import { ActionIcon, Loader, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { downloadMediaFile } from "../../store/mediaDownload";
import { t } from "../../i18n/i18n";

/** The Download control in ImageLightbox/MediaPreviewDialog's top-right
 * corner, just left of their ✕ and styled to match it. `blobUrl` is the
 * file the viewer already fetched to show, so saving it costs no second
 * download; `fileName` is resolved by downloadMediaFile() when the viewer
 * only knows a handle (a zoomable thumbnail anywhere in the app). */
export function FullscreenDownloadButton({ handle, blobUrl, fileName }: {
  handle: string;
  blobUrl: string | null;
  fileName?: string;
}) {
  const [busy, setBusy] = useState(false);
  async function handleClick() {
    if (!blobUrl) return;
    setBusy(true);
    try {
      await downloadMediaFile(handle, { blobUrl, fileName });
    } catch (err: any) {
      notifications.show({ color: "red", title: t("Download failed"), message: err?.message ?? String(err) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Tooltip label={t("Download")} withArrow position="bottom">
      <ActionIcon
        variant="filled"
        color="dark"
        size={36}
        radius="xl"
        onClick={handleClick}
        disabled={!blobUrl || busy}
        aria-label={t("Download")}
        // Same as the ✕ beside it: ImageLightbox's frame setPointerCapture()s
        // on pointerdown, which would retarget this button's click to the
        // frame instead.
        onPointerDown={(e) => e.stopPropagation()}
        style={{ position: "absolute", top: 16, right: 60, zIndex: 3 }}
      >
        {busy ? (
          <Loader size={16} color="white" />
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 4v11" />
            <path d="M7 10l5 5 5-5" />
            <path d="M5 20h14" />
          </svg>
        )}
      </ActionIcon>
    </Tooltip>
  );
}
