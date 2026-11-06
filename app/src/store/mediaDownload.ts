// "Save this Media object's file" -- shared by RelatedPanel's Media
// Download button, the Output rows' GeneratedItemActions.tsx, and the
// full-screen ImageLightbox/MediaPreviewDialog. Those dialogs only know a
// handle (they open from any zoomable thumbnail), so the file name is
// resolved here when the caller doesn't already have one.
import { notifications } from "@mantine/notifications";
import { API_BASE } from "../config";
import { getToken } from "../auth/auth";
import { parseErrorMessage } from "./api";
import { apiFetch } from "./apiFetch";
import { fetchAuthedBlobUrl } from "./authedFetch";
import { clickDownloadLink } from "./downloadFile";
import { notifyBrowser } from "./browserNotifications";
import { FILE_NAME_ATTRIBUTE } from "./jobsApi";
import { t } from "../i18n/i18n";

type NameSource = {
  handle: string;
  path?: unknown;
  attribute_list?: unknown;
};

/** The name a downloaded file is saved under: a generated item's recorded
 * original name (jobsApi.ts's FILE_NAME_ATTRIBUTE), else the last segment
 * of the Media object's stored `path` (Gramps paths can carry folders, and
 * a `download` attribute containing a separator is either rejected or
 * mangled by browsers), else the handle. */
export function mediaDownloadName(media: NameSource): string {
  const attributes = Array.isArray(media.attribute_list)
    ? (media.attribute_list as { type?: string; value?: string }[])
    : [];
  const recorded = attributes.find((a) => a.type === FILE_NAME_ATTRIBUTE)?.value?.trim();
  if (recorded) return recorded;
  const path = typeof media.path === "string" ? media.path : "";
  const base = path.split(/[\\/]/).filter(Boolean).pop()?.trim();
  return base || media.handle;
}

async function fetchMediaNameSource(handle: string, token: string): Promise<NameSource> {
  const res = await apiFetch(
    `${API_BASE}/api/media/${encodeURIComponent(handle)}?keys=handle,path,attribute_list`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(await parseErrorMessage(res));
  return { handle, ...(await res.json()) };
}

/** Downloads a Media object's file to the user's machine and returns the
 * name it was saved as. `fileName` skips the metadata lookup; `blobUrl`
 * reuses a file the caller already fetched (a full-screen viewer showing
 * it) instead of downloading it a second time -- the caller still owns
 * that URL's lifetime. Throws on a failed fetch; the success toast is
 * shown here so every entry point reports the same way. */
export async function downloadMediaFile(
  handle: string,
  opts: { fileName?: string; blobUrl?: string; title?: string } = {}
): Promise<string> {
  const token = await getToken();
  // Name first (a small request) so a failed lookup never leaves an
  // already-fetched blob unrevoked.
  const name = opts.fileName ?? mediaDownloadName(await fetchMediaNameSource(handle, token));
  const objectUrl = opts.blobUrl ?? (await fetchAuthedBlobUrl(`/api/media/${encodeURIComponent(handle)}/file`, token));
  try {
    clickDownloadLink(objectUrl, name);
  } finally {
    // Safari needs the URL to outlive the click; a task turn is enough.
    if (!opts.blobUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
  // The page gets no callback from the browser's (or the desktop build's
  // native Save-As) download machinery, so this can't confirm the save
  // completed -- but on desktop that dialog can land behind the window,
  // and without a toast the click would look like it did nothing.
  const title = opts.title ?? t("File downloaded");
  const message = `${name} — ${t("saved to your downloads.")}`;
  notifications.show({ color: "green", title, message });
  notifyBrowser(title, message);
  return name;
}
