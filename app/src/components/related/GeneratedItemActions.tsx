import { useState } from "react";
import { Alert, Button, Group } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { deleteMedia, FILE_NAME_ATTRIBUTE } from "../../store/jobsApi";
import { clickDownloadLink } from "../../store/downloadFile";
import { fetchAuthedBlobUrl } from "../../store/authedFetch";
import type { ObjectDetail } from "../../store/objectDetail";
import { zipHandles } from "./sections/shared";
import { t } from "../../i18n/i18n";

/** Download + "Delete this report/export?" flow for an Output row (plan
 * §5) -- gramps-connect has no generic per-object download affordance
 * elsewhere (a Media object's file is only ever shown as a thumbnail, see
 * MediaThumbnail.tsx), so this is scoped to RelatedPanel's `view.key ===
 * "generated"` branch rather than added to every type. Report rows get the
 * same delete-confirmation flow export rows already had -- a conscious
 * decision (discussion #4, F4), not an oversight left over from before
 * this offered delete at all: both are equally regenerable from the tree
 * on demand, and leaving report rows with no cleanup path at all was the
 * asymmetry, not the risk of an accidental delete. */
export function GeneratedItemActions({ detail }: { detail: ObjectDetail }) {
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  const tags = zipHandles<{ name?: string }>(detail.tag_list, detail.extended?.tags);
  const isExport = tags.some((t) => t.target?.name === "export");
  const kind = isExport ? "export" : "report";

  // Absent on anything generated before file names were recorded (and on
  // ordinary media, which this component never renders for) -- those keep
  // the server's own name, which is the media object's checksum-derived
  // path. See jobsApi.ts's FILE_NAME_ATTRIBUTE.
  const attributes = (detail.attribute_list as { type?: string; value?: string }[] | undefined) ?? [];
  const fileName = attributes.find((attr) => attr.type === FILE_NAME_ATTRIBUTE)?.value;

  if (deleted) {
    return <Alert color="gray">{t(isExport ? "Export deleted." : "Report deleted.")}</Alert>;
  }

  async function handleDownload() {
    setError(null);
    try {
      const token = await getToken();
      // The `download` attribute (the only way to give a downloaded file a
      // name other than the server's own) only works on same-origin URLs,
      // which the API isn't in any deployment where it's a separate host
      // (see config.ts) -- so the file is always fetched into a blob first,
      // whose object URL *is* same-origin. Discussion #4's "tokens in
      // image URLs" note: this also means the access token never needs to
      // ride in the URL at all (the previous no-recorded-name branch used
      // to build one with `?jwt=`), same fetchAuthedBlobUrl() every other
      // single-item (not list/gallery) call site uses. `path` is the raw
      // Media object's own stored filename (checksum-derived) -- the same
      // name a recorded-name-less download already fell back to before,
      // just read directly instead of leaving it for the server's
      // Content-Disposition to imply. Exports of a large tree are the
      // biggest thing through here, and tens of MB is well within what a
      // blob handles.
      const objectUrl = await fetchAuthedBlobUrl(`/api/media/${encodeURIComponent(detail.handle)}/file`, token);
      try {
        // clickDownloadLink() only sets the `download` attribute when given
        // a name -- without one at all, a blob: URL's own <a> would
        // *navigate* to it instead of downloading, since there's no
        // Content-Disposition on a locally-built blob to fall back on the
        // way the old `?download=true` URL relied on. `detail.handle` as
        // the last resort matches the delete-confirmation text's own
        // fallback just below.
        clickDownloadLink(objectUrl, fileName ?? (detail.path as string | undefined) ?? detail.handle);
      } finally {
        // Safari needs the URL to outlive the click; a task turn is
        // enough, and the blob is freed either way.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      }

      if (
        hasPermissions("DeleteObject") &&
        window.confirm(`Delete this ${kind} "${fileName ?? detail.handle}"? There is no undo.`)
      ) {
        await deleteMedia(token, detail.handle);
        setDeleted(true);
      }
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
  }

  return (
    <Group gap="xs">
      <Button size="xs" onClick={handleDownload}>{t("Download")}</Button>
      {error && <Alert color="red">{error}</Alert>}
    </Group>
  );
}
