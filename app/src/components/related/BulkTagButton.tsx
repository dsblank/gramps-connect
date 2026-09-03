import { useState } from "react";
import { Alert, Button, Modal, Stack, Text } from "@mantine/core";
import { getToken, hasPermissions } from "../../auth/auth";
import { getViewStore } from "../../store/registry";
import { attachRefListEntry } from "../../store/refListApi";
import { TAG_VIEW } from "../../store/views";
import type { ViewConfig } from "../../store/views";
import type { QueryItem } from "../../store/api";
import { RecordPicker } from "../RecordPicker";
import { pickerResultLabel } from "../RefPickerField";
import { t } from "../../i18n/i18n";

/** SelectionBulkView.tsx's header action for 3+ selected rows -- opens the
 * same TAG_VIEW-scoped RecordPicker AttachControl.tsx already uses for its
 * single-object tag picker (RecordPicker itself is reused as-is, not
 * rebuilt), then loops attachRefListEntry over every selected handle
 * instead of just one. Existing-tag pick only, same as AttachControl -- no
 * "create new tag" affordance in this first pass. */
export function BulkTagButton({ view, handles }: { view: ViewConfig; handles: string[] }) {
  const [opened, setOpened] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasPermissions("EditObject")) return null;

  async function handlePick(item: QueryItem) {
    setApplying(true);
    setError(null);
    try {
      const token = await getToken();
      await Promise.all(handles.map((h) => attachRefListEntry(token, view, h, "tag_list", item.handle)));
      getViewStore(view.key).requeryDebounced();
      setOpened(false);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <Button variant="default" size="xs" onClick={() => { setError(null); setOpened(true); }}>
        {t("Tag")}
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title={`${t("Adding a tag")} — ${handles.length} ${t("objects")}`} size="sm">
        <Stack gap="md">
          {error && (
            <Alert color="red" title={t("Could not tag")}>
              {error}
            </Alert>
          )}
          <Text size="sm" c={applying ? "dimmed" : undefined}>
            {applying ? t("Applying…") : null}
          </Text>
          <RecordPicker
            view={TAG_VIEW}
            searchField="gramps_id"
            placeholder={TAG_VIEW.simpleSearch?.placeholder ?? "Search…"}
            buildExpr={TAG_VIEW.simpleSearch?.buildExpr}
            renderLabel={(item) => pickerResultLabel(TAG_VIEW.key, item)}
            onPick={handlePick}
            confirmWithButton
          />
        </Stack>
      </Modal>
    </>
  );
}
