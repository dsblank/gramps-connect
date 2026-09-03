import { useEffect, useState } from "react";
import { Alert, Button, Group, Loader, Modal, Stack, Text } from "@mantine/core";
import { getToken } from "../../auth/auth";
import { getViewStore } from "../../store/registry";
import { fetchPlainObject } from "../../store/objectsApi";
import { mergeObjects } from "../../store/mergeApi";
import type { ViewConfig } from "../../store/views";
import { summaryLine } from "./summary";
import { t } from "../../i18n/i18n";

/** The "which one survives?" picker for MergeButton.tsx -- a standalone
 * Modal (not part of the edit-dialog Modal.Stack: opened from a DataTable
 * selection, not from inside a draft) mirroring gramps-web's own merge
 * dialog (GrampsjsViewObjectsBase.js's _renderMergeDialog/_handleMerge):
 * pick which of the two selected records is "phoenix" (kept, edited with
 * the merged data) vs. "titanic" (deleted). No field-level conflict picker
 * -- gramps-web-api's merge routes take no such input, they apply Gramps'
 * own built-in merge-query field-combination rules server-side.
 *
 * NOT the same thing as related/CompareModal.tsx (an unrelated before/after
 * image slider for Media's "Comparisons" section) -- named differently on
 * purpose to avoid confusion with that existing feature. */
export function MergeDialog({
  opened, onClose, view, handles, onMerged,
}: {
  opened: boolean;
  onClose: () => void;
  view: ViewConfig;
  handles: [string, string];
  onMerged: () => void;
}) {
  const [labels, setLabels] = useState<[string, string] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setLabels(null);
    setError(null);
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const [a, b] = await Promise.all(handles.map((h) => fetchPlainObject(token, view, h)));
        if (!cancelled) setLabels([summaryLine(view.key, a), summaryLine(view.key, b)]);
      } catch (err: any) {
        if (!cancelled) setError(err.message ?? String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opened, view, handles[0], handles[1]]);

  async function handleMerge(phoenix: string, titanic: string) {
    setMerging(true);
    setError(null);
    try {
      const token = await getToken();
      await mergeObjects(token, view, phoenix, titanic);
      getViewStore(view.key).requeryDebounced();
      getViewStore(view.key).clearSelection();
      onMerged();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setMerging(false);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t("Merge")}>
      <Stack gap="md">
        <Text size="sm">
          {t("Select the object that will provide the primary data for the merged object. The other is deleted.")}
        </Text>
        {error && (
          <Alert color="red" title={t("Could not merge")}>
            {error}
          </Alert>
        )}
        {labels === null ? (
          <Group justify="center" p="md">
            <Loader size="sm" />
          </Group>
        ) : (
          <Group gap="xs" wrap="wrap">
            <Button variant="default" loading={merging} onClick={() => handleMerge(handles[0], handles[1])}>
              {labels[0]}
            </Button>
            <Button variant="default" loading={merging} onClick={() => handleMerge(handles[1], handles[0])}>
              {labels[1]}
            </Button>
          </Group>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose} disabled={merging}>
            {t("Cancel")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
