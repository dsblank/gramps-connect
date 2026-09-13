export type PreviewKind = "video" | "audio" | "pdf" | "html" | "json" | "text";

/** What MediaViewButton/MediaPreviewDialog can show for a given mime type,
 * or null when nothing here can render it (a Download is still offered
 * elsewhere -- GeneratedItemActions.tsx for Output rows -- for those).
 * Deliberately excludes image/* (including image/svg+xml): MediaThumbnail.tsx's
 * zoomable click already opens ImageLightbox for those, so a second "View"
 * button here would just duplicate it. "xml" is matched loosely (not just
 * text/xml) so KML map overlays (application/vnd.google-earth.kml+xml) get
 * a raw-source view too, alongside MediaMapButton.tsx's own richer
 * "see it on the map" view for those. */
export function previewKindForMime(mime: string | undefined): PreviewKind | null {
  if (!mime) return null;
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/html") return "html";
  if (mime === "application/json") return "json";
  if (mime.startsWith("text/") || mime.includes("xml")) return "text";
  return null;
}
