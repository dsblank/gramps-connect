import { useState } from "react";
import { Alert, Button, Chip, Group, Loader, Modal, Stack, Text } from "@mantine/core";
import { getToken, isTokenFresh } from "../auth/auth";
import {
  deleteAllObjects,
  DELETE_NAMESPACES,
  FreshTokenRequiredError,
  type DeleteNamespace,
} from "../store/deleteApi";
import { clearAllOpfs } from "../store/opfs";
import { describeTaskFailure, waitForTask } from "../store/taskApi";
import { ReloginDialog } from "./ReloginDialog";
import { t } from "../i18n/i18n";

const NAMESPACE_LABELS: Record<DeleteNamespace, string> = {
  people: "People",
  families: "Families",
  events: "Events",
  places: "Places",
  sources: "Sources",
  citations: "Citations",
  repositories: "Repositories",
  notes: "Notes",
  media: "Media",
  tags: "Tags",
};

type Stage = "select" | "deleting" | "error";

interface DeleteAllDialogProps {
  opened: boolean;
  onClose: () => void;
}

/** Family Trees -> Delete... -- mirrors gramps-web's admin
 * "Delete..." screen: pick which object types to wipe (all
 * selected by default), a loud non-reversible warning, then confirm.
 * gramps-web-api requires a fresh JWT for this endpoint, so a stale
 * session gets routed through ReloginDialog before the request goes out
 * (or mid-flight, if the token happened to refresh in between). */
export function DeleteAllDialog({ opened, onClose }: DeleteAllDialogProps) {
  const [selected, setSelected] = useState<string[]>([...DELETE_NAMESPACES]);
  const [stage, setStage] = useState<Stage>("select");
  const [error, setError] = useState("");
  const [reloginOpened, setReloginOpened] = useState(false);

  function reset() {
    setSelected([...DELETE_NAMESPACES]);
    setStage("select");
    setError("");
  }

  function handleClose() {
    if (stage === "deleting") return;
    reset();
    onClose();
  }

  async function performDelete() {
    setStage("deleting");
    try {
      const token = await getToken();
      const result = await deleteAllObjects(token, selected as DeleteNamespace[]);
      if (result.kind === "task") {
        const status = await waitForTask(result.task.id);
        if (status.state !== "SUCCESS") {
          throw new Error(describeTaskFailure(status));
        }
      }
      // Every view's local cache is now stale (some rows it holds no
      // longer exist server-side) -- see clearAllOpfs()'s doc comment.
      // Nothing left to confirm at this point, so reload straight away
      // rather than making the user click through a second dialog.
      await clearAllOpfs();
      window.location.reload();
    } catch (err: any) {
      if (err instanceof FreshTokenRequiredError) {
        setStage("select");
        setReloginOpened(true);
        return;
      }
      setError(err.message ?? String(err));
      setStage("error");
    }
  }

  function handleDeleteClick() {
    if (isTokenFresh()) {
      performDelete();
    } else {
      setReloginOpened(true);
    }
  }

  return (
    <>
      <Modal
        opened={opened}
        onClose={handleClose}
        title={t("Delete")}
        closeOnClickOutside={stage !== "deleting"}
        closeOnEscape={stage !== "deleting"}
      >
        <Stack gap="md">
          {stage === "select" && (
            <>
              <Alert color="red" title={t("This cannot be undone")}>
                {t("This permanently deletes every selected object from the current family tree, for every user. There is no undo.")}
              </Alert>
              <Text size="sm">{t("Object types to delete:")}</Text>
              <Chip.Group multiple value={selected} onChange={setSelected}>
                <Group gap="xs">
                  {DELETE_NAMESPACES.map((ns) => (
                    <Chip key={ns} value={ns} size="xs">
                      {NAMESPACE_LABELS[ns]}
                    </Chip>
                  ))}
                </Group>
              </Chip.Group>
              <Group justify="flex-end">
                <Button variant="default" onClick={handleClose}>
                  {t("Cancel")}
                </Button>
                <Button color="red" disabled={selected.length === 0} onClick={handleDeleteClick}>
                  {t("Delete")}
                </Button>
              </Group>
            </>
          )}

          {stage === "deleting" && (
            <Group justify="center" py="md">
              <Loader size="sm" color="red" />
              <Text size="sm">{t("Deleting… this may take a while.")}</Text>
            </Group>
          )}

          {stage === "error" && (
            <>
              <Alert color="red" title={t("Delete failed")}>
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
      <ReloginDialog
        opened={reloginOpened}
        onClose={() => setReloginOpened(false)}
        onSuccess={() => {
          setReloginOpened(false);
          performDelete();
        }}
      />
    </>
  );
}
