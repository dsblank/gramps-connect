import { useEffect, useState } from "react";
import { Image } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { mediaThumbnailUrl } from "../../store/mediaCrop";
import { ImageLightbox } from "./ImageLightbox";

/** MIME types gramps-web-api's thumbnailer actually handles (see
 * ThumbnailHandler.__init__ in gramps_webapi/api/image.py): any image/* or
 * video/* (first frame), plus application/pdf (first page) as the one
 * MIME_NO_IMAGE special case. Everything else (audio, plain text, ...)
 * raises ValueError server-side -- skip the request entirely rather than
 * relying on onError to mask a guaranteed failure. */
function isThumbnailable(mime: string | undefined): boolean {
  if (!mime) return false;
  return mime.startsWith("image/") || mime.startsWith("video/") || mime === "application/pdf";
}

/** A media object's thumbnail -- GET /api/media/<handle>/thumbnail/<size>
 * accepts auth as a `jwt` query param specifically so it can be used as a
 * plain <img src> (an <img> tag can't set an Authorization header the way
 * every other fetch in this app does). Renders nothing (not a broken-image
 * icon) for a non-thumbnailable MIME type, a signed-out gap before the
 * token resolves, or a failed load (private/missing file, thumbnailer
 * dependency not installed server-side, ...). */
export function MediaThumbnail({ handle, mime, size, radius = "sm", zoomable = false, rect }: {
  handle: string;
  mime?: string;
  size: number;
  /** "sm" for the usual inline thumbnail; "md" for the larger
   * profile-picture treatment in RelatedPanel's header. Deliberately not
   * a circular crop ("50%") -- tried that first, but a scanned document
   * or a landscape/group photo doesn't survive being cropped to a
   * circle the way a portrait does. */
  radius?: string;
  /** The referencing MediaRef's own crop region (RefMeta.rect), when it has
   * one -- renders the gramps-web-api `/cropped/.../thumbnail/<size>` route
   * instead of the plain one, same convention treeData.ts's
   * personThumbnailUrl already uses for TreeView boxes. Ignored (falls back
   * to the plain thumbnail) when absent, empty, or degenerate. */
  rect?: number[] | null;
  /** Clicking the thumbnail itself opens ImageLightbox.tsx on the original
   * file. Deliberately doesn't stop the click from also reaching whatever
   * onClick the caller already put on an ancestor button (promote,
   * navigate) -- both fire, so e.g. clicking a media-gallery tile still
   * selects it (its detail is there once the lightbox is closed) as well as
   * popping the full-size view immediately. Only offered for true images: a
   * video/PDF thumbnail is just a first-frame/first-page preview, so "view
   * full size" wouldn't show the whole file the way it does for a photo. */
  zoomable?: boolean;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!isThumbnailable(mime)) return;
    let cancelled = false;
    getToken().then((t) => {
      if (!cancelled) setToken(t);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [handle, mime]);

  if (!isThumbnailable(mime) || !token || failed) return null;

  const showZoom = zoomable && mime?.startsWith("image/");

  return (
    <>
      <Image
        src={mediaThumbnailUrl(handle, size, token, { rect })}
        alt=""
        w={size}
        h={size}
        fit="cover"
        radius={radius}
        onError={() => setFailed(true)}
        onClick={showZoom ? () => setLightboxOpen(true) : undefined}
        style={showZoom ? { cursor: "zoom-in" } : undefined}
      />
      {showZoom && (
        <ImageLightbox opened={lightboxOpen} onClose={() => setLightboxOpen(false)} handle={handle} />
      )}
    </>
  );
}
