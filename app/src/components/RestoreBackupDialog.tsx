import { useState } from "react";
import { Alert, Button, FileButton, Group, List, Loader, Modal, Stack, Text } from "@mantine/core";
import { getToken, isTokenFresh } from "../auth/auth";
import { FreshTokenRequiredError } from "../store/deleteApi";
import { clearAllOpfs } from "../store/opfs";
import { describeTaskFailure, waitForTask } from "../store/taskApi";
import { previewRestore, runRestore, type RestoreSummary } from "../store/toolsApi";
import { ReloginDialog } from "./ReloginDialog";
import { t } from "../i18n/i18n";

type Stage = "select" | "previewing" | "preview" | "restoring" | "error";

const SUMMARY_SECTIONS: { key: keyof RestoreSummary; label: string }[] = [
  { key: "to_add", label: "Would be added" },
  { key: "to_update", label: "Would be overwritten" },
  { key: "to_delete", label: "Would be deleted" },
];

const BUSY_STAGES = new Set<Stage>(["previewing", "restoring"]);

interface RestoreBackupDialogProps {
  opened: boolean;
  onClose: () => void;
}

function summaryLines(summary: RestoreSummary): { label: string; entries: [string, number][] }[] {
  return SUMMARY_SECTIONS.map(({ key, label }) => ({
    label,
    entries: Object.entries(summary[key] ?? {}).filter(([, n]) => n > 0),
  })).filter((section) => section.entries.length > 0);
}

/** Tools -> Restore from Backup -- resets the *entire current tree* to
 * exactly match an uploaded Gramps XML file: anything not in the backup is
 * deleted, matching entries are overwritten, same destructive shape as
 * DeleteAllDialog.tsx (which this mirrors for the fresh-JWT relogin
 * handling) but scoped by file contents rather than object type. Needs both
 * ImportFile and BatchDeleteObjects server-side (RestoreFileResource), so it
 * shares BatchDeleteObjects' fresh-token requirement -- the Tools menu item
 * itself is only gated on ImportFile+BatchDeleteObjects together, matching
 * the permissions this dialog actually exercises. */
export function RestoreBackupDialog({ opened, onClose }: RestoreBackupDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("select");
  const [summary, setSummary] = useState<RestoreSummary | null>(null);
  const [error, setError] = useState("");
  const [reloginOpened, setReloginOpened] = useState(false);

  function reset() {
    setFile(null);
    setStage("select");
    setSummary(null);
    setError("");
  }

  function handleClose() {
    if (BUSY_STAGES.has(stage)) return;
    reset();
    onClose();
  }

  async function handlePreview() {
    if (!file) return;
    setStage("previewing");
    try {
      const token = await getToken();
      const result = await previewRestore(token, file);
      const finalSummary =
        result.kind === "task"
          ? ((await waitForTask(result.task.id)).result_object as RestoreSummary)
          : result.summary;
      setSummary(finalSummary);
      setStage("preview");
    } catch (err: any) {
      setError(err.message ?? String(err));
      setStage("error");
    }
  }

  async function performRestore() {
    if (!file) return;
    setStage("restoring");
    try {
      const token = await getToken();
      const result = await runRestore(token, file);
      if (result.kind === "task") {
        const status = await waitForTask(result.task.id);
        if (status.state !== "SUCCESS") {
          throw new Error(describeTaskFailure(status));
        }
      }
      await clearAllOpfs();
      window.location.reload();
    } catch (err: any) {
      if (err instanceof FreshTokenRequiredError) {
        setStage("preview");
        setReloginOpened(true);
        return;
      }
      setError(err.message ?? String(err));
      setStage("error");
    }
  }

  function handleConfirmClick() {
    if (isTokenFresh()) {
      performRestore();
    } else {
      setReloginOpened(true);
    }
  }

  return (
    <>
      <Modal
        opened={opened}
        onClose={handleClose}
        title={t("Restore from Backup")}
        closeOnClickOutside={!BUSY_STAGES.has(stage)}
        closeOnEscape={!BUSY_STAGES.has(stage)}
      >
        <Stack gap="md">
          {stage === "select" && (
            <>
              <Alert color="red" title={t("This replaces the entire tree")}>
                {t("Restoring resets this family tree to exactly match the uploaded backup: anything not in the backup is deleted. There is no undo.")}
              </Alert>
              <FileButton onChange={setFile} accept=".gramps">
                {(props) => (
                  <Button {...props} variant="light">{t("Choose backup file (.gramps)")}</Button>
                )}
              </FileButton>
              {file && <Text size="sm">{file.name}</Text>}
              <Group justify="flex-end">
                <Button variant="default" onClick={handleClose}>{t("Cancel")}</Button>
                <Button disabled={!file} onClick={handlePreview}>{t("Preview")}</Button>
              </Group>
            </>
          )}

          {stage === "previewing" && (
            <Group justify="center" py="md">
              <Loader size="sm" />
              <Text size="sm">{t("Comparing to the backup…")}</Text>
            </Group>
          )}

          {stage === "preview" && summary && (
            <>
              <Text size="sm">{t("This backup differs from the current tree as follows:")}</Text>
              {summaryLines(summary).length === 0 ? (
                <Text size="sm" c="dimmed">{t("No differences found.")}</Text>
              ) : (
                summaryLines(summary).map((section) => (
                  <Stack key={section.label} gap={2}>
                    <Text size="sm" fw={600}>{t(section.label)}</Text>
                    <List size="sm">
                      {section.entries.map(([key, n]) => (
                        <List.Item key={key}>{key}: {n}</List.Item>
                      ))}
                    </List>
                  </Stack>
                ))
              )}
              <Alert color="red">
                {t("Confirming replaces the entire tree with this backup, for every user. There is no undo.")}
              </Alert>
              <Group justify="flex-end">
                <Button variant="default" onClick={handleClose}>{t("Cancel")}</Button>
                <Button color="red" onClick={handleConfirmClick}>{t("Restore")}</Button>
              </Group>
            </>
          )}

          {stage === "restoring" && (
            <Group justify="center" py="md">
              <Loader size="sm" color="red" />
              <Text size="sm">{t("Restoring… this may take a while.")}</Text>
            </Group>
          )}

          {stage === "error" && (
            <>
              <Alert color="red" title={t("Restore failed")}>{error}</Alert>
              <Group justify="flex-end">
                <Button variant="default" onClick={reset}>{t("Try again")}</Button>
                <Button variant="subtle" onClick={handleClose}>{t("Close")}</Button>
              </Group>
            </>
          )}
        </Stack>
      </Modal>
      <ReloginDialog
        opened={reloginOpened}
        onClose={() => setReloginOpened(false)}
        onSuccess={() => {
          setReloginOpened(false);
          performRestore();
        }}
      />
    </>
  );
}
