export type PreviewKind = "video" | "audio" | "pdf" | "svg" | "html" | "json" | "text";

/** What MediaViewButton/MediaPreviewDialog can show for a given mime type,
 * or null when nothing here can render it (a Download is still offered
 * elsewhere -- GeneratedItemActions.tsx for Output rows -- for those).
 * Deliberately excludes every other image/* type: MediaThumbnail.tsx's
 * zoomable click already opens ImageLightbox for those, so a second "View"
 * button here would just duplicate it. image/svg+xml is the one exception --
 * gramps-web-api's thumbnailer shells out to Pillow (image.py's
 * ThumbnailHandler), which can't rasterize SVG at all, so MediaThumbnail's
 * <Image> never even mounts for one (onError fires immediately, see its own
 * doc comment) and there is no zoomable click to fall back on. Handled here
 * instead, checked before the generic "xml" text match below so it renders
 * as an actual picture (a plain <img> pointed at the raw file -- SVG is one
 * of the few formats every browser rasterizes client-side with no server
 * help needed) rather than as XML source. "xml" is otherwise matched
 * loosely (not just text/xml) so KML map overlays
 * (application/vnd.google-earth.kml+xml) get a raw-source view too,
 * alongside MediaMapButton.tsx's own richer "see it on the map" view for
 * those. */
export function previewKindForMime(mime: string | undefined): PreviewKind | null {
  if (!mime) return null;
  if (mime === "image/svg+xml") return "svg";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/html") return "html";
  if (mime === "application/json") return "json";
  if (mime.startsWith("text/") || mime.includes("xml")) return "text";
  return null;
}
