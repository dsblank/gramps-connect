import { useState } from "react";
import { Alert, Button, Group, Loader, Modal, Stack, Text } from "@mantine/core";
import { getToken } from "../auth/auth";
import { describeTaskFailure, waitForTask } from "../store/taskApi";
import type { TaskPostResult } from "../store/toolsApi";
import { t } from "../i18n/i18n";

type Stage = "confirm" | "running" | "done" | "error";

interface ConfirmTaskDialogProps {
  opened: boolean;
  onClose: () => void;
  title: string;
  /** Shown on the confirm screen -- what this is about to do. */
  description: string;
  /** Shown once the task finishes successfully. */
  successMessage: string;
  /** Shown while the task is running. */
  runningMessage: string;
  run: (token: string) => Promise<TaskPostResult>;
}

/** Generic "explain, confirm, run a Celery task, report the outcome"
 * dialog for Tools menu actions that need nothing beyond a single button --
 * Check & Repair Database and Upgrade Database Schema. Both endpoints are
 * plain ProtectedResource (no fresh-JWT requirement, unlike
 * DeleteAllDialog.tsx/RestoreBackupDialog.tsx), so there's no relogin path
 * here. */
export function ConfirmTaskDialog({
  opened, onClose, title, description, successMessage, runningMessage, run,
}: ConfirmTaskDialogProps) {
  const [stage, setStage] = useState<Stage>("confirm");
  const [error, setError] = useState("");

  function reset() {
    setStage("confirm");
    setError("");
  }

  function handleClose() {
    if (stage === "running") return;
    reset();
    onClose();
  }

  async function handleRun() {
    setStage("running");
    try {
      const token = await getToken();
      const result = await run(token);
      if (result.kind === "task") {
        const status = await waitForTask(result.task.id);
        if (status.state !== "SUCCESS") {
          throw new Error(describeTaskFailure(status));
        }
      }
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
      title={title}
      closeOnClickOutside={stage !== "running"}
      closeOnEscape={stage !== "running"}
    >
      <Stack gap="md">
        {stage === "confirm" && (
          <>
            <Text size="sm">{description}</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={handleClose}>{t("Cancel")}</Button>
              <Button onClick={handleRun}>{t("Run")}</Button>
            </Group>
          </>
        )}
        {stage === "running" && (
          <Group justify="center" py="md">
            <Loader size="sm" />
            <Text size="sm">{runningMessage}</Text>
          </Group>
        )}
        {stage === "done" && (
          <>
            <Alert color="green">{successMessage}</Alert>
            <Group justify="flex-end">
              <Button onClick={handleClose}>{t("Close")}</Button>
            </Group>
          </>
        )}
        {stage === "error" && (
          <>
            <Alert color="red" title={t("Failed")}>{error}</Alert>
            <Group justify="flex-end">
              <Button variant="default" onClick={reset}>{t("Try again")}</Button>
              <Button variant="subtle" onClick={handleClose}>{t("Close")}</Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
