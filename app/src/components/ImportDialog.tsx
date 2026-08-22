import { useState } from "react";
import { Alert, Button, FileButton, Group, List, Loader, Modal, Stack, Text } from "@mantine/core";
import { getToken } from "../auth/auth";
import { IMPORT_EXTENSIONS, previewImport, runImport, type ImportCounts } from "../store/importApi";
import { clearAllOpfs } from "../store/opfs";
import { describeTaskFailure, waitForTask } from "../store/taskApi";
import { t } from "../i18n/i18n";

type Stage = "select" | "previewing" | "preview" | "importing" | "error";

// ObjectCountsSchema's fixed field set (gramps-web-api's schemas.py).
const COUNT_LABELS: Record<string, string> = {
  people: "People",
  families: "Families",
  events: "Events",
  places: "Places",
  repositories: "Repositories",
  sources: "Sources",
  citations: "Citations",
  media: "Media",
  notes: "Notes",
  tags: "Tags",
};

const BUSY_STAGES = new Set<Stage>(["previewing", "importing"]);

interface ImportDialogProps {
  opened: boolean;
  onClose: () => void;
}

function extensionOf(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

/** Family Trees -> Import... flow: pick a file, preview its object counts
 * via a dry run, then confirm to run the real import. Both preview and the
 * real import dispatch the same Celery task (import_file) gramps-web-api
 * already runs for gramps-web's own import screen, so this just drives that
 * existing endpoint rather than adding anything server-side. */
export function ImportDialog({ opened, onClose }: ImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("select");
  const [counts, setCounts] = useState<ImportCounts | null>(null);
  const [error, setError] = useState("");

  function reset() {
    setFile(null);
    setStage("select");
    setCounts(null);
    setError("");
  }

  function handleClose() {
    if (BUSY_STAGES.has(stage)) return;
    reset();
    onClose();
  }

  async function handlePreview() {
    if (!file) return;
    const ext = extensionOf(file);
    if (!(IMPORT_EXTENSIONS as readonly string[]).includes(ext)) {
      setError(`Unsupported file type: .${ext || "?"}`);
      setStage("error");
      return;
    }
    setStage("previewing");
    try {
      const token = await getToken();
      const result = await previewImport(token, ext, file);
      const finalCounts =
        result.kind === "task"
          ? ((await waitForTask(token, result.task.id)).result_object as ImportCounts)
          : result.kind === "counts"
            ? result.counts
            : {};
      setCounts(finalCounts);
      setStage("preview");
    } catch (err: any) {
      setError(err.message ?? String(err));
      setStage("error");
    }
  }

  async function handleConfirm() {
    if (!file) return;
    const ext = extensionOf(file);
    setStage("importing");
    try {
      const token = await getToken();
      const result = await runImport(token, ext, file);
      if (result.kind === "task") {
        const status = await waitForTask(token, result.task.id);
        if (status.state !== "SUCCESS") {
          throw new Error(describeTaskFailure(status));
        }
      }
      // Every view's local cache is now stale (it's missing the newly
      // imported rows) -- see clearAllOpfs()'s doc comment. Nothing left
      // to confirm at this point, so reload straight away rather than
      // making the user click through a second dialog.
      await clearAllOpfs();
      window.location.reload();
    } catch (err: any) {
      setError(err.message ?? String(err));
      setStage("error");
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={t("Import Family Tree")}
      closeOnClickOutside={!BUSY_STAGES.has(stage)}
      closeOnEscape={!BUSY_STAGES.has(stage)}
    >
      <Stack gap="md">
        {stage === "select" && (
          <>
            <FileButton onChange={setFile} accept={IMPORT_EXTENSIONS.map((ext) => `.${ext}`).join(",")}>
              {(props) => (
                <Button {...props} variant="light">
                  {t("Choose file")}
                </Button>
              )}
            </FileButton>
            {file && <Text size="sm">{file.name}</Text>}
            <Group justify="flex-end">
              <Button variant="default" onClick={handleClose}>
                {t("Cancel")}
              </Button>
              <Button disabled={!file} onClick={handlePreview}>
                {t("Preview")}
              </Button>
            </Group>
          </>
        )}

        {stage === "previewing" && (
          <Group justify="center" py="md">
            <Loader size="sm" />
            <Text size="sm">{t("Reading file…")}</Text>
          </Group>
        )}

        {stage === "preview" && counts && (
          <>
            <Text size="sm">{t("This file contains:")}</Text>
            <List size="sm">
              {Object.entries(counts)
                .filter(([, n]) => n > 0)
                .map(([key, n]) => (
                  <List.Item key={key}>
                    {COUNT_LABELS[key] ?? key}: {n}
                  </List.Item>
                ))}
            </List>
            <Text size="sm" c="dimmed">
              {t("Importing adds this data to the current family tree and locks it for writes by everyone else until it finishes. This cannot be undone from here.")}
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={handleClose}>
                {t("Cancel")}
              </Button>
              <Button onClick={handleConfirm}>{t("Import")}</Button>
            </Group>
          </>
        )}

        {stage === "importing" && (
          <Group justify="center" py="md">
            <Loader size="sm" />
            <Text size="sm">{t("Importing… this may take a while.")}</Text>
          </Group>
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
