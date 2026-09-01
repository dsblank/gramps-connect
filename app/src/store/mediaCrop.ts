// Shared home for MediaRef.rect handling -- a `[left, top, right, bottom]`
// percentage crop (0-100 integers), gramps' own convention (see
// gramps/gen/lib/mediaref.py's get_schema) and confirmed server-side in
// gramps-web-api's crop_image() (api/image.py), which interprets the same
// four ints as percent of the *displayed* (EXIF-oriented) image. Used
// wherever a media reference's own rect needs to become a thumbnail URL --
// originally only treeData.ts's personThumbnailUrl, now also
// MediaThumbnail.tsx, so the clamp/URL-building logic lives in one place
// rather than two copies drifting apart.
import { API_BASE } from "../config";

export function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** GET /api/media/<handle>/thumbnail/<size> or, when `rect` is a valid
 * 4-element region, the .../cropped/<x1>/<y1>/<x2>/<y2>/thumbnail/<size>
 * variant instead. `jwt` as a query param is the only way to authenticate a
 * plain URL an <img>/SVG <image> can use directly (see MediaThumbnail.tsx's
 * own doc comment) -- fine for the many-thumbnails-at-once case this is for,
 * unlike ImageLightbox.tsx's single full-size image, which fetches a blob
 * URL instead to keep the token out of the URL entirely. */
export function mediaThumbnailUrl(
  handle: string,
  size: number,
  token: string,
  opts?: { rect?: number[] | null; square?: boolean }
): string {
  const base = `${API_BASE}/api/media/${encodeURIComponent(handle)}`;
  const jwt = encodeURIComponent(token);
  const square = opts?.square ? "&square=true" : "";
  const rect = opts?.rect;
  if (rect && rect.length === 4) {
    const [x1, y1, x2, y2] = rect.map(clampPct);
    if (x2 > x1 && y2 > y1) {
      return `${base}/cropped/${x1}/${y1}/${x2}/${y2}/thumbnail/${size}?jwt=${jwt}${square}`;
    }
  }
  return `${base}/thumbnail/${size}?jwt=${jwt}${square}`;
}
