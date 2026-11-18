import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { hasPermissions } from "../../auth/auth";
import { getViewStore } from "../../store/registry";
import { editSelected, supportsBulkEdit, type BulkEditProgress } from "../../store/bulkEdit";
import type { ViewConfig } from "../../store/views";
import { t } from "../../i18n/i18n";
import { BulkEditProgressBar, bulkEditSummary } from "./BulkEditProgress";

/** Beside BulkTagButton (2 selected, and 3+): make every selected record
 * private, or public, in one request and one transaction
 * (store/bulkEdit.ts). Only each record's own privacy changes, not that of
 * the references and other parts inside it -- the same as the Private
 * switch in its editor. */
export function BulkPrivacyButton({ view, handles }: { view: ViewConfig; handles: string[] }) {
  const [opened, setOpened] = useState(false);
  const [applying, setApplying] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<BulkEditProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!hasPermissions("EditObject") || !supportsBulkEdit(view)) return null;

  async function apply(value: boolean) {
    setApplying(value);
    setError(null);
    setProgress(null);
    try {
      const changed = await editSelected(view, handles, [{ op: "set_private", value }], setProgress);
      notifications.show({
        color: "green",
        message: bulkEditSummary(value ? t("Made %s objects private.") : t("Made %s objects public."), changed, handles.length),
      });
      setOpened(false);
    } catch (err: any) {
      // One transaction: on an error nothing was changed.
      setError(err.message ?? String(err));
    } finally {
      getViewStore(view.key).requeryDebounced();
      setApplying(null);
    }
  }

  const busy = applying !== null;
  return (
    <>
      <Button variant="default" size="xs" onClick={() => { setError(null); setOpened(true); }}>
        {t("Privacy")}
      </Button>
      <Modal
        opened={opened}
        onClose={() => { if (!busy) setOpened(false); }}
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
        title={`${t("Privacy")} — ${handles.length.toLocaleString()} ${t("objects")}`}
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            {t("Private records are hidden from users with the Guest role. This changes each record itself, not the references inside it.")}
          </Text>
          {error && (
            <Alert color="red" title={t("Could not change privacy")}>
              {error}
            </Alert>
          )}
          {busy && <BulkEditProgressBar progress={progress} />}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => void apply(false)} loading={applying === false} disabled={busy}>
              {t("Make public")}
            </Button>
            <Button onClick={() => void apply(true)} loading={applying === true} disabled={busy}>
              {t("Make private")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
