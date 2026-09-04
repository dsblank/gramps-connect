import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Group, Loader, Modal, Stack, Text } from "@mantine/core";
import { getToken } from "../auth/auth";
import { fetchMetadata } from "../store/metadataApi";
import { describeTaskFailure, waitForTask } from "../store/taskApi";
import { triggerReindex } from "../store/toolsApi";
import { t } from "../i18n/i18n";

type Stage = "confirm" | "running" | "done" | "error";

interface ReindexDialogProps {
  opened: boolean;
  onClose: () => void;
}

/** Tools -> Rebuild search index -- POST /api/search/index/, the same
 * action gramps-web's Administration screen offers as two separate buttons
 * (full-text vs semantic); combined here into one dialog with both choices,
 * since they're independent boolean query params on the same endpoint. The
 * semantic checkbox only appears once metadata confirms the server actually
 * has an embedding model configured (metadataApi.ts's
 * `server.semantic_search`) -- offering it otherwise would let a user
 * request an index the server has no way to build. */
export function ReindexDialog({ opened, onClose }: ReindexDialogProps) {
  const [full, setFull] = useState(false);
  const [semantic, setSemantic] = useState(false);
  const [semanticAvailable, setSemanticAvailable] = useState(false);
  const [stage, setStage] = useState<Stage>("confirm");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!opened) return;
    setFull(false);
    setSemantic(false);
    setStage("confirm");
    setError("");
    (async () => {
      try {
        const token = await getToken();
        const metadata = await fetchMetadata(token);
        setSemanticAvailable(metadata.server?.semantic_search ?? false);
      } catch {
        setSemanticAvailable(false);
      }
    })();
  }, [opened]);

  function handleClose() {
    if (stage === "running") return;
    onClose();
  }

  async function handleRun() {
    setStage("running");
    try {
      const token = await getToken();
      const result = await triggerReindex(token, full, semantic);
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
      title={t("Rebuild Search Index")}
      closeOnClickOutside={stage !== "running"}
      closeOnEscape={stage !== "running"}
    >
      <Stack gap="md">
        {stage === "confirm" && (
          <>
            <Text size="sm">
              {t("Rebuilds the server's search index for this tree. An incremental rebuild only reindexes objects that changed since the last run; a full rebuild starts from scratch.")}
            </Text>
            <Checkbox
              label={t("Full rebuild (slower, reindexes everything)")}
              checked={full}
              onChange={(e) => setFull(e.currentTarget.checked)}
            />
            {semanticAvailable && (
              <Checkbox
                label={t("Semantic (vector) index instead of full-text")}
                checked={semantic}
                onChange={(e) => setSemantic(e.currentTarget.checked)}
              />
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={handleClose}>{t("Cancel")}</Button>
              <Button onClick={handleRun}>{t("Rebuild")}</Button>
            </Group>
          </>
        )}
        {stage === "running" && (
          <Group justify="center" py="md">
            <Loader size="sm" />
            <Text size="sm">{t("Rebuilding search index… this may take a while.")}</Text>
          </Group>
        )}
        {stage === "done" && (
          <>
            <Alert color="green">{t("Search index rebuilt.")}</Alert>
            <Group justify="flex-end">
              <Button onClick={handleClose}>{t("Close")}</Button>
            </Group>
          </>
        )}
        {stage === "error" && (
          <>
            <Alert color="red" title={t("Failed")}>{error}</Alert>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setStage("confirm")}>{t("Try again")}</Button>
              <Button variant="subtle" onClick={handleClose}>{t("Close")}</Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
