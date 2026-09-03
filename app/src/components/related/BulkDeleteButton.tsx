import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { getViewStore } from "../../store/registry";
import { deleteObjectsBulk } from "../../store/mergeApi";
import type { ViewConfig } from "../../store/views";
import { t } from "../../i18n/i18n";

/** SelectionBulkView.tsx's header action for 3+ selected rows -- same
 * confirm-then-delete shape as the single-object DeleteButton.tsx, but one
 * request/transaction for every selected handle (POST
 * /api/objects/delete-by-handle/) rather than looping single deletes. */
export function BulkDeleteButton({ view, handles }: { view: ViewConfig; handles: string[] }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasPermissions("DeleteObject")) return null;

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const token = await getToken();
      await deleteObjectsBulk(token, view, handles);
      getViewStore(view.key).requeryDebounced();
      getViewStore(view.key).clearSelection();
      setConfirmOpen(false);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Button variant="default" size="xs" onClick={() => { setError(null); setConfirmOpen(true); }}>
        {t("Delete")}
      </Button>
      <Modal opened={confirmOpen} onClose={() => setConfirmOpen(false)} title={`${t("Delete")} ${handles.length} ${t("objects")}?`}>
        <Stack gap="md">
          <Text size="sm">
            {t("This permanently deletes every selected object. Every other reference to them is cleaned up automatically. There is no undo.")}
          </Text>
          {error && (
            <Alert color="red" title={t("Could not delete")}>
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              {t("Cancel")}
            </Button>
            <Button color="red" onClick={handleDelete} loading={deleting}>
              {t("Delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
