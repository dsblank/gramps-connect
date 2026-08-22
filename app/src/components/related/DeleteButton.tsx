import { useState } from "react";
import { Alert, Button, Checkbox, Group, Modal, Stack, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { getViewStore } from "../../store/registry";
import { deleteObject } from "../../store/objectsApi";
import type { ObjectDetail } from "../../store/objectDetail";
import type { ViewConfig } from "../../store/views";
import { summaryLine } from "./summary";
import { t } from "../../i18n/i18n";

/** Top-right icon on a RelatedPanel (in the same header action slot as
 * EditButton/MessageButton) that deletes this record, after confirmation.
 *
 * Deliberately a plain single-object delete, nothing more: gramps-web-api
 * has no "clean up now-orphaned linked items" capability to lean on (the
 * one maintenance endpoint, POST /api/trees/<id>/check/, only fixes broken
 * backlink bookkeeping and removes literally-empty records -- not orphan
 * cleanup), and computing that client-side was explicitly deferred --
 * the confirmation dialog carries a disabled "Remove all orphaned items"
 * checkbox as a placeholder for that future work, not a working option.
 * What the server *does* do on delete (delete.py's per-type delete_person/
 * delete_event/delete_citation/...): strip the deleted handle out of every
 * *other* object that referenced it, so nothing is left pointing at a
 * handle that no longer exists -- and, where a reference is *required*
 * rather than optional (a Citation's source_handle), cascade-delete the
 * dependent object too instead of leaving it invalid (delete_source,
 * delete.py:412-497 -- confirmed live: deleting a Source that a Citation
 * pointed at deletes the Citation as well, not just its reference).
 * The confirmation copy below reflects this.
 *
 * Excludes "messages" and "generated" -- both already have their own
 * delete affordance inline in the body (MessageActions.tsx/
 * GeneratedItemActions.tsx), predating this button; adding a second one
 * in the header would just be a redundant control. Everywhere else, any
 * user holding DeleteObject gets it -- unlike EditButton, there's no
 * EDITABLE_TYPES restriction, since every real object type is deletable
 * even where a create/edit dialog doesn't exist for it (e.g. Media).
 *
 * No draftStack needed (unlike EditButton) -- deleting doesn't open a
 * dialog, so this works in both RelatedPanel's top-pane mount and
 * ReferenceDetail's bottom-pane one without any prop threading. */
export function DeleteButton({ view, detail }: { view: ViewConfig; detail: ObjectDetail }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligible = view.key !== "messages" && view.key !== "generated";
  if (!eligible || !hasPermissions("DeleteObject")) return null;

  const label = `Delete this ${view.key}`;
  const summary = summaryLine(view.key, detail) || view.label;

  function openConfirm() {
    setError(null);
    setConfirmOpen(true);
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const token = await getToken();
      await deleteObject(token, view, detail.handle);
      // Immediate feedback rather than waiting on historyPoll's next tick
      // (same reasoning as draftStack.ts's saveAll) -- ViewStore's own
      // reconcileSelection() then handles "the selected row is gone" the
      // same way it already does for a live-sync delete notification.
      getViewStore(view.key).requeryDebounced();
      setConfirmOpen(false);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Tooltip label={label} withArrow>
        <UnstyledButton onClick={openConfirm} aria-label={label}>
          <Text size="lg" lh={1}>🗑</Text>
        </UnstyledButton>
      </Tooltip>
      <Modal opened={confirmOpen} onClose={() => setConfirmOpen(false)} title={`Delete this ${view.key}?`}>
        <Stack gap="md">
          <Text size="sm">
            This permanently deletes <b>{summary}</b>. Every other reference to it is cleaned up
            automatically -- but a record that <i>{t("requires")}</i> this one (e.g. a Citation's Source) is
            deleted right along with it, not just un-linked. There is no undo.
          </Text>
          <Checkbox
            checked={false}
            disabled
            label={t("Remove all orphaned items")}
            description="Not implemented yet -- see this dialog's doc comment for why."
            readOnly
          />
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
