// Shared by every single-item (not list/gallery) call site that fetches a
// gramps-web-api file/media URL -- discussion #4's "tokens in image URLs"
// note: an <img src>/MapLibre `image` source/plain `<a href>` can't carry
// an Authorization header, so the previous approach put the access token
// in a `?jwt=` query param instead (still done today by
// MediaThumbnail.tsx and treeData.ts's personThumbnailUrl, deliberately
// left alone -- see their own doc comments on why: both render many
// images at once, where this fetch-then-blob approach's per-item overhead
// and manual cleanup cost is a real tradeoff against the leaked-token risk
// this closes, unlike everywhere else this is used).
//
// fetchAuthedBlobUrl() fetches the real URL with a normal Authorization
// header (never in the URL, never in any log line) and returns a same-
// origin `blob:` object URL instead -- the token itself never appears in
// any URL a browser, proxy, or server access log could ever record. The
// caller owns the returned URL's lifetime: it must call
// URL.revokeObjectURL() on it once it's no longer needed (an <img>
// unmounting, the handle it was fetched for changing, or right after a
// one-shot download click resolves).
import { API_BASE } from "../config";
import { parseErrorMessage } from "./api";

export async function fetchAuthedBlobUrl(
  path: string,
  token: string,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return URL.createObjectURL(await res.blob());
}
