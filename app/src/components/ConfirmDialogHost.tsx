import { useSyncExternalStore } from "react";
import { Button, Group, Modal, Text } from "@mantine/core";
import { getConfirmDialogRequest, resolveConfirmDialog, subscribeConfirmDialog } from "../store/confirmDialog";
import { t } from "../i18n/i18n";

/** Single app-wide modal answering every confirmDialog() call (store/
 * confirmDialog.ts) -- the Mantine-styled replacement for window.confirm
 * used by every RelatedPanel section's "remove this reference" action, plus
 * the handful of plain "delete this item" confirms outside RelatedPanel
 * (ChatBubble, GeneratedItemActions, UserManagementPanel). DeleteButton.tsx
 * keeps its own heavier Modal (cascade-delete copy, disabled orphan-cleanup
 * checkbox, inline error state) rather than routing through here -- this
 * one is only ever a plain yes/no.
 *
 * Mounted once in App.tsx beside FloatingTopicWindows, the same singleton-
 * store-plus-host pattern topicWindows.ts/FloatingTopicWindows.tsx already
 * use, rather than a per-call-site <Modal> each section would otherwise
 * have to wire its own open/close state for. */
export function ConfirmDialogHost() {
  const request = useSyncExternalStore(subscribeConfirmDialog, getConfirmDialogRequest);
  return (
    <Modal opened={request != null} onClose={() => resolveConfirmDialog(false)} title={t("Confirm")} size="sm">
      <Text size="sm">{request?.message}</Text>
      <Group justify="flex-end" mt="md">
        <Button
          variant={request?.cancelColor ? undefined : "default"}
          color={request?.cancelColor}
          onClick={() => resolveConfirmDialog(false)}
        >
          {t(request?.cancelLabel ?? "Cancel")}
        </Button>
        <Button color="red" onClick={() => resolveConfirmDialog(true)}>
          {t(request?.confirmLabel ?? "Remove")}
        </Button>
      </Group>
    </Modal>
  );
}
