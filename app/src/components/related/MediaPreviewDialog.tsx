import { useEffect, useState } from "react";
import { ActionIcon, Alert, Box, Loader, Modal, ScrollArea } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { fetchAuthedBlobUrl } from "../../store/authedFetch";
import { t } from "../../i18n/i18n";
import type { PreviewKind } from "./mediaPreviewKind";

function filePath(handle: string): string {
  return `/api/media/${encodeURIComponent(handle)}/file`;
}

/** Fullscreen preview of a Media/Output object's raw file, for every
 * browser-renderable kind MediaViewButton.tsx offers -- everything
 * MediaThumbnail.tsx's zoomable image click doesn't already cover. PDF and
 * video/audio get the browser's own native viewer/player (an <iframe>/
 * <video>/<audio> pointed at the file's blob: URL); HTML reports render
 * inside a fully sandboxed iframe (`sandbox=""` -- no scripts, no forms, no
 * same-origin) so a generated report's markup shows formatted without ever
 * executing anything a hostile or malformed report might contain; JSON is
 * pretty-printed; everything else (plain text, CSV, GEDCOM, KML/XML, ...)
 * shows as monospace source. Same fullScreen + no-Modal.Stack presentation
 * ImageLightbox.tsx uses for images, for the same reason (this is the only
 * thing on screen while it's open). */
export function MediaPreviewDialog({ opened, onClose, handle, kind }: {
  opened: boolean;
  onClose: () => void;
  handle: string;
  kind: PreviewKind;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetches fresh on every open (not cached), same as ImageLightbox --
  // revokes its own blob URL on close/unmount so it never outlives this
  // one dialog.
  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setError(null);
    setBlobUrl(null);
    setText(null);
    (async () => {
      try {
        const token = await getToken();
        const url = await fetchAuthedBlobUrl(filePath(handle), token);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        if (kind === "video" || kind === "audio" || kind === "pdf") {
          setBlobUrl(url);
          return;
        }
        const raw = await (await fetch(url)).text();
        if (cancelled) return;
        if (kind === "json") {
          try {
            setText(JSON.stringify(JSON.parse(raw), null, 2));
          } catch {
            setText(raw);
          }
        } else {
          setText(raw);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? String(err));
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [opened, handle, kind]);

  const loading = !error && blobUrl === null && text === null;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen
      withCloseButton={false}
      styles={{ body: { height: "100vh", padding: 0 } }}
    >
      <Box style={{ position: "relative", width: "100%", height: "100%" }}>
        {loading && (
          <Loader style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)" }} />
        )}
        {error && (
          <Alert color="red" m="md" title={t("Couldn't load this file")}>
            {error}
          </Alert>
        )}
        {blobUrl && kind === "video" && (
          <video
            controls
            autoPlay
            src={blobUrl}
            style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
          />
        )}
        {blobUrl && kind === "audio" && (
          <Box style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <audio controls autoPlay src={blobUrl} />
          </Box>
        )}
        {blobUrl && kind === "pdf" && (
          <iframe src={blobUrl} title={t("Preview")} style={{ width: "100%", height: "100%", border: 0 }} />
        )}
        {text !== null && kind === "html" && (
          <iframe
            srcDoc={text}
            sandbox=""
            title={t("Preview")}
            style={{ width: "100%", height: "100%", border: 0, background: "#fff" }}
          />
        )}
        {text !== null && kind !== "html" && (
          <ScrollArea style={{ height: "100%" }} p="md">
            <Box
              component="pre"
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace", fontSize: "0.8125rem", margin: 0 }}
            >
              {text}
            </Box>
          </ScrollArea>
        )}
        <ActionIcon
          variant="filled"
          color="dark"
          size={36}
          radius="xl"
          onClick={onClose}
          aria-label={t("Close")}
          style={{ position: "absolute", top: 16, right: 16, zIndex: 3 }}
        >
          ✕
        </ActionIcon>
      </Box>
    </Modal>
  );
}
