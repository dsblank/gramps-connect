import { useState } from "react";
import { Alert, Button, Group, Modal, Progress, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { hasPermissions, isTokenFresh } from "../../auth/auth";
import { getViewStore } from "../../store/registry";
import { BULK_DELETE_THRESHOLD, PartialDeleteError, deleteSelected, type BulkDeleteProgress } from "../../store/bulkDelete";
import type { ViewConfig } from "../../store/views";
import { ReloginDialog } from "../ReloginDialog";
import { t } from "../../i18n/i18n";

/** The selection pane's bulk Delete (SelectionBulkView.tsx for 3+ selected
 * rows, SelectionDetailView.tsx for 2) -- same confirm-then-delete shape as
 * the single-object DeleteButton.tsx, at any selection size: bulkDelete.ts's
 * deleteSelected() picks one request, a background task, or chunks. Past
 * BULK_DELETE_THRESHOLD records it first asks for the password unless the
 * session's token is fresh (ReloginDialog, as Tools -> Delete items... does)
 * -- a guard against a mistaken Ctrl/Cmd+A, not a permission check. */
export function BulkDeleteButton({ view, handles }: { view: ViewConfig; handles: string[] }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reloginOpen, setReloginOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState<BulkDeleteProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!hasPermissions("DeleteObject")) return null;

  const count = handles.length.toLocaleString();
  const large = handles.length > BULK_DELETE_THRESHOLD;

  function handleConfirm() {
    if (large && !isTokenFresh()) setReloginOpen(true);
    else void runDelete();
  }

  async function runDelete() {
    setDeleting(true);
    setError(null);
    setProgress(null);
    const store = getViewStore(view.key);
    try {
      await deleteSelected(view, handles, setProgress);
      // Out of the local list (and the selection) at once, so the detail
      // pane never lands on a record that's gone -- see removeDeleted().
      store.removeDeleted(handles);
      store.requeryDebounced();
      setConfirmOpen(false);
      if (large) notifications.show({ color: "green", message: t("Deleted %s objects.").replace("%s", count) });
    } catch (err: any) {
      if (err instanceof PartialDeleteError) {
        // Some chunks went through (older server, see deleteSelected()):
        // they go in order, so it's the first `deleted` handles. Show the
        // list as it now is, and say how far it got.
        store.removeDeleted(handles.slice(0, err.deleted));
        store.requeryDebounced();
        setError(
          t("Deleted %s of %s before an error: %s")
            .replace("%s", err.deleted.toLocaleString())
            .replace("%s", count)
            .replace("%s", err.message)
        );
      } else {
        setError(err.message ?? String(err));
      }
    } finally {
      setDeleting(false);
      setProgress(null);
    }
  }

  return (
    <>
      <Button variant="default" size="xs" onClick={() => { setError(null); setConfirmOpen(true); }}>
        {t("Delete")}
      </Button>
      <Modal
        opened={confirmOpen}
        onClose={() => { if (!deleting) setConfirmOpen(false); }}
        closeOnClickOutside={!deleting}
        closeOnEscape={!deleting}
        withCloseButton={!deleting}
        title={`${t("Delete")} ${count} ${t("objects")}?`}
      >
        <Stack gap="md">
          <Text size="sm">
            {t("This permanently deletes every selected object. Every other reference to them is cleaned up automatically.")}
            {view.key === "place" && (
              <> {t("Any place enclosed by one of these is reattached to its surviving parent instead of being left orphaned.")}</>
            )}{" "}
            {t("There is no undo.")}
          </Text>
          {large && !deleting && !isTokenFresh() && (
            <Text size="sm" c="dimmed">
              {t("Deleting this many objects asks for your password first.")}
            </Text>
          )}
          {deleting && <DeleteProgress progress={progress} total={handles.length} />}
          {error && (
            <Alert color="red" title={t("Could not delete")}>
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              {t("Cancel")}
            </Button>
            <Button color="red" onClick={handleConfirm} loading={deleting}>
              {`${t("Delete")} ${count}`}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <ReloginDialog
        opened={reloginOpen}
        onClose={() => setReloginOpen(false)}
        onSuccess={() => {
          setReloginOpen(false);
          void runDelete();
        }}
      />
    </>
  );
}

/** "Reattaching places…", then "Deleted 1,500 of 4,900" with a bar once
 * the count is known -- a small delete finishes before anything shows. */
function DeleteProgress({ progress, total }: { progress: BulkDeleteProgress | null; total: number }) {
  if (progress?.phase === "places") {
    return <Text size="sm" c="dimmed">{t("Reattaching enclosed places…")}</Text>;
  }
  const done = progress?.done ?? null;
  return (
    <Stack gap={4}>
      <Progress value={done === null ? 100 : (100 * done) / total} animated={done === null} />
      <Text size="xs" c="dimmed">
        {done === null
          ? t("Deleting…")
          : t("Deleted %s of %s").replace("%s", done.toLocaleString()).replace("%s", total.toLocaleString())}
      </Text>
    </Stack>
  );
}
