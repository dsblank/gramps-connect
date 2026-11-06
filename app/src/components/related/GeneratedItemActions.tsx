import { useState } from "react";
import { Alert, Button } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { confirmDialog } from "../../store/confirmDialog";
import { deleteMedia, deleteNote, FILE_NAME_ATTRIBUTE, findJobReportNotes } from "../../store/jobsApi";
import { downloadMediaFile, mediaDownloadName } from "../../store/mediaDownload";
import type { ObjectDetail } from "../../store/objectDetail";
import { zipHandles } from "./sections/shared";
import { t } from "../../i18n/i18n";

/** Download + "Delete this report/export?" flow for an Output row (plan
 * §5). Ordinary Media rows get a plain MediaDownloadButton.tsx instead;
 * this one exists separately for the keep-or-discard prompt that follows
 * a generated item's download. Report rows get the
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
      // Shared with the Media pane's own Download (store/mediaDownload.ts):
      // fetched into a same-origin blob so the `download` attribute can
      // name the file, with the token in a header rather than the URL.
      // `fileName` is passed so no extra metadata lookup is needed -- this
      // row's detail is already loaded.
      await downloadMediaFile(detail.handle, {
        fileName: mediaDownloadName(detail),
        title: isExport ? t("Export downloaded") : t("Report downloaded"),
      });
      const token = await getToken();

      if (
        hasPermissions("DeleteObject") &&
        // Framed as "keep it?" rather than "delete it?" -- the file was
        // already uploaded as a Media object before this button ever
        // rendered (see jobsPromote.ts's promoteJob), so there's nothing
        // left to opt into here, only a chance to opt out. A red "Delete"
        // button here previously read as destroying something the user
        // hadn't consented to yet, when it's really just declining to
        // keep a copy already made -- plain "Don't save" says that
        // without the false alarm. false (Save, green, or dismissing the
        // dialog -- Escape/backdrop) means keep it, matching
        // confirmDialog()'s usual "false = safe default" convention
        // app-wide; only the explicit "Don't save" click resolves true.
        (await confirmDialog(`Save this ${kind} "${fileName ?? detail.handle}" as a media object?`, "Don't save", {
          cancelLabel: "Save",
          cancelColor: "green",
          confirmVariant: "default",
        }))
      ) {
        // An export's report Note (jobsPromote.ts's promoteJob) is about
        // this file only, so it goes with it -- Gramps never cascades a
        // Media delete to its notes, which would leave it orphaned in the
        // Notes view. Looked up before the delete, while note_list still
        // points at it.
        const reportNotes = await findJobReportNotes(token, (detail.note_list as string[] | undefined) ?? []);
        await deleteMedia(token, detail.handle);
        setDeleted(true);
        // Best-effort: the export itself is already gone, so a failed note
        // delete mustn't surface as if the whole delete had failed.
        for (const note of reportNotes) {
          await deleteNote(token, note).catch((err) => console.error(`report note ${note} delete failed`, err));
        }
      }
    } catch (err: any) {
      setError(err.message ?? String(err));
    }
  }

  return (
    <>
      <Button size="xs" onClick={handleDownload}>{t("Download")}</Button>
      {error && <Alert color="red">{error}</Alert>}
    </>
  );
}
