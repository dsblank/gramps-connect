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
// Above every manually-`zIndex`-nested dialog anywhere in this app (the
// highest in use elsewhere tops out at 1001, e.g. FilterPickerDialog.tsx's
// own Custom Rules -> GOQL-help chain) -- confirmDialog() can be called
// from any of them (found live: FilterPickerDialog's own confirm-before-
// discard rendered *underneath* its Filters dialog at the plain default
// z-index both Modals otherwise share), and a caller has no way to pass
// this Modal a zIndex of its own to match wherever it happens to be
// called from. Since this is meant to always read as "the topmost thing
// right now" regardless of what triggered it, a comfortably-higher fixed
// constant is more robust than chasing the current highest nested value
// by one every time a new caller nests one level deeper.
const CONFIRM_DIALOG_Z_INDEX = 2000;

export function ConfirmDialogHost() {
  const request = useSyncExternalStore(subscribeConfirmDialog, getConfirmDialogRequest);
  return (
    <Modal
      opened={request != null}
      onClose={() => resolveConfirmDialog(false)}
      title={t("Confirm")}
      size="sm"
      zIndex={CONFIRM_DIALOG_Z_INDEX}
    >
      <Text size="sm">{request?.message}</Text>
      <Group justify="flex-end" mt="md">
        <Button
          variant={request?.cancelColor ? undefined : "default"}
          color={request?.cancelColor}
          onClick={() => resolveConfirmDialog(false)}
        >
          {t(request?.cancelLabel ?? "Cancel")}
        </Button>
        <Button
          variant={request?.confirmVariant}
          color={request?.confirmVariant ? undefined : "red"}
          onClick={() => resolveConfirmDialog(true)}
        >
          {t(request?.confirmLabel ?? "Remove")}
        </Button>
      </Group>
    </Modal>
  );
}
