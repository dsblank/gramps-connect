import { useState } from "react";
import { notifications } from "@mantine/notifications";
import type { ObjectDetail } from "../../store/objectDetail";
import { downloadMediaFile, mediaDownloadName } from "../../store/mediaDownload";
import { ViewButton } from "./ViewButton";
import { t } from "../../i18n/i18n";

/** A Media row's "save this file" button, beside MediaViewButton's View in
 * the "ways of viewing this record" row. Offered for every mime type --
 * for one the browser can't render (a zip, ...) it's the only way to get
 * at the file. Output rows don't use this: GeneratedItemActions.tsx has
 * its own Download, followed by the keep-or-discard prompt. */
export function MediaDownloadButton({ detail }: { detail: ObjectDetail }) {
  const [busy, setBusy] = useState(false);
  async function handleClick() {
    setBusy(true);
    try {
      await downloadMediaFile(detail.handle, { fileName: mediaDownloadName(detail) });
    } catch (err: any) {
      notifications.show({ color: "red", title: t("Download failed"), message: err?.message ?? String(err) });
    } finally {
      setBusy(false);
    }
  }
  return <ViewButton label={t("Download")} onClick={handleClick} loading={busy} />;
}
