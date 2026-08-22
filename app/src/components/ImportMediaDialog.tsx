import { useState } from "react";
import {
  Alert,
  Button,
  FileButton,
  Group,
  List,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { getToken } from "../auth/auth";
import {
  listMissingMedia,
  postMediaZip,
  type MediaImportCounts,
  type MissingMediaPage,
} from "../store/mediaImportApi";
import { clearAllOpfs } from "../store/opfs";
import { describeTaskFailure, waitForTask } from "../store/taskApi";
import { t } from "../i18n/i18n";

type Stage = "select" | "uploading" | "done" | "error";

interface ImportMediaDialogProps {
  opened: boolean;
  onClose: () => void;
}

/** Family Trees -> Import... -> Media...: upload a ZIP of image files to
 * restore missing files on Media objects already in the tree, matched by
 * checksum (or relative path, for objects with no checksum yet) -- see
 * mediaImportApi.ts. This does not create new Media objects for images the
 * tree has no record of. */
export function ImportMediaDialog({ opened, onClose }: ImportMediaDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("select");
  const [counts, setCounts] = useState<MediaImportCounts | null>(null);
  const [missingMedia, setMissingMedia] = useState<MissingMediaPage>({ items: [], total: 0 });
  const [error, setError] = useState("");

  function reset() {
    setFile(null);
    setStage("select");
    setCounts(null);
    setMissingMedia({ items: [], total: 0 });
    setError("");
  }

  function handleClose() {
    if (stage === "uploading") return;
    reset();
    onClose();
  }

  async function handleConfirm() {
    if (!file) return;
    setStage("uploading");
    try {
      const token = await getToken();
      const result = await postMediaZip(token, file);
      let resolvedCounts: MediaImportCounts;
      if (result.kind === "task") {
        const status = await waitForTask(token, result.task.id);
        if (status.state !== "SUCCESS") {
          throw new Error(describeTaskFailure(status));
        }
        resolvedCounts = status.result_object as MediaImportCounts;
      } else {
        resolvedCounts = result.counts;
      }
      setCounts(resolvedCounts);
      const stillMissing =
        resolvedCounts.missing - resolvedCounts.uploaded - resolvedCounts.failures;
      if (stillMissing > 0) {
        // Best-effort: the expected paths are a debugging aid (e.g. to
        // check the zip's folder structure against what the tree expects),
        // not required for the import's own result -- a failure here
        // shouldn't turn a successful import into an error screen.
        try {
          setMissingMedia(await listMissingMedia(token));
        } catch (err) {
          console.error("failed to list still-missing media", err);
        }
      }
      // Files were (re)attached to existing Media objects, and a checksum
      // fix-up may have changed rows too -- see clearAllOpfs()'s doc
      // comment for why every view's local cache is now suspect.
      await clearAllOpfs();
      setStage("done");
    } catch (err: any) {
      setError(err.message ?? String(err));
      setStage("error");
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={t("Import Media")}
      closeOnClickOutside={stage !== "uploading"}
      closeOnEscape={stage !== "uploading"}
    >
      <Stack gap="md">
        {stage === "select" && (
          <>
            <Text size="sm" c="dimmed">
              {t("Upload a ZIP archive of image files. Files matching the checksum (or path) of a Media object already in the tree that's missing its file are attached to it. This does not create new Media objects for images the tree has no record of.")}
            </Text>
            <FileButton onChange={setFile} accept=".zip">
              {(props) => (
                <Button {...props} variant="light">
                  {t("Choose ZIP file")}
                </Button>
              )}
            </FileButton>
            {file && <Text size="sm">{file.name}</Text>}
            <Group justify="flex-end">
              <Button variant="default" onClick={handleClose}>
                {t("Cancel")}
              </Button>
              <Button disabled={!file} onClick={handleConfirm}>
                {t("Import")}
              </Button>
            </Group>
          </>
        )}

        {stage === "uploading" && (
          <Group justify="center" py="md">
            <Loader size="sm" />
            <Text size="sm">{t("Uploading… this may take a while.")}</Text>
          </Group>
        )}

        {stage === "done" && counts && (
          <>
            <List size="sm">
              <List.Item>Files uploaded: {counts.uploaded}</List.Item>
              <List.Item>Still missing: {counts.missing - counts.uploaded - counts.failures}</List.Item>
              {counts.failures > 0 && <List.Item>Failed to upload: {counts.failures}</List.Item>}
            </List>
            {missingMedia.items.length > 0 && (
              <>
                <Text size="sm" c="dimmed">
                  Expected paths for objects still missing a file -- compare against the zip's
                  folder structure
                  {missingMedia.total > missingMedia.items.length &&
                    ` (showing first ${missingMedia.items.length} of ${missingMedia.total})`}
                  :
                </Text>
                <ScrollArea.Autosize mah={200} type="auto">
                  <List size="sm">
                    {missingMedia.items.map((m) => (
                      <List.Item key={m.handle}>
                        <Text size="sm" ff="monospace">
                          {m.path || "(no path set)"}
                        </Text>
                      </List.Item>
                    ))}
                  </List>
                </ScrollArea.Autosize>
              </>
            )}
            <Group justify="flex-end">
              <Button onClick={() => window.location.reload()}>{t("Close")}</Button>
            </Group>
          </>
        )}

        {stage === "error" && (
          <>
            <Alert color="red" title={t("Import failed")}>
              {error}
            </Alert>
            <Group justify="flex-end">
              <Button variant="default" onClick={reset}>
                {t("Try again")}
              </Button>
              <Button variant="subtle" onClick={handleClose}>
                {t("Close")}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
