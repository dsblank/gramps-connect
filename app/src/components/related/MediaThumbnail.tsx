import { useEffect, useState } from "react";
import { Image } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { API_BASE } from "../../config";

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
export function MediaThumbnail({ handle, mime, size, radius = "sm" }: {
  handle: string;
  mime?: string;
  size: number;
  /** "sm" for the usual inline thumbnail; "md" for the larger
   * profile-picture treatment in RelatedPanel's header. Deliberately not
   * a circular crop ("50%") -- tried that first, but a scanned document
   * or a landscape/group photo doesn't survive being cropped to a
   * circle the way a portrait does. */
  radius?: string;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

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

  return (
    <Image
      src={`${API_BASE}/api/media/${encodeURIComponent(handle)}/thumbnail/${size}?jwt=${encodeURIComponent(token)}`}
      alt=""
      w={size}
      h={size}
      fit="cover"
      radius={radius}
      onError={() => setFailed(true)}
    />
  );
}
