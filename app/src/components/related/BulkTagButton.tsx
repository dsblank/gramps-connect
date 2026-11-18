import { useState } from "react";
import { Alert, Modal, SegmentedControl, Stack, Button } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { getToken, hasPermissions } from "../../auth/auth";
import { getViewStore } from "../../store/registry";
import { getOrCreateTagHandle } from "../../store/jobsApi";
import { editSelected, supportsBulkEdit, type BulkEditProgress } from "../../store/bulkEdit";
import { TAG_VIEW } from "../../store/views";
import type { ViewConfig } from "../../store/views";
import type { QueryItem } from "../../store/api";
import { RecordPicker } from "../RecordPicker";
import { pickerResultLabel } from "../RefPickerField";
import { t } from "../../i18n/i18n";
import { BulkEditProgressBar, bulkEditSummary } from "./BulkEditProgress";

type Mode = "add" | "remove";

/** SelectionBulkView.tsx's header action for 3+ selected rows (and
 * SelectionDetailView.tsx's for exactly 2): add a tag to every selected
 * record, or remove one from them, in one request and one transaction
 * (store/bulkEdit.ts) -- so one Undo puts it back. Picking uses the same
 * TAG_VIEW-scoped RecordPicker AttachControl.tsx uses for one record.
 * Adding also takes a new name (jobsApi.ts's getOrCreateTagHandle:
 * get-or-create by exact name, no dialog), so "select or create" is one
 * step; removing only offers existing tags. */
export function BulkTagButton({ view, handles }: { view: ViewConfig; handles: string[] }) {
  const [opened, setOpened] = useState(false);
  const [mode, setMode] = useState<Mode>("add");
  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState<BulkEditProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!hasPermissions("EditObject") || !supportsBulkEdit(view)) return null;

  async function apply(tagHandle: string) {
    setApplying(true);
    setError(null);
    setProgress(null);
    try {
      const changed = await editSelected(view, handles, [{ op: mode === "add" ? "add_tag" : "remove_tag", handle: tagHandle }], setProgress);
      notifications.show({
        color: "green",
        message: bulkEditSummary(mode === "add" ? t("Tagged %s objects.") : t("Removed the tag from %s objects."), changed, handles.length),
      });
      setOpened(false);
    } catch (err: any) {
      // One transaction: on an error nothing was changed.
      setError(err.message ?? String(err));
    } finally {
      getViewStore(view.key).requeryDebounced();
      setApplying(false);
    }
  }

  async function handlePick(item: QueryItem) {
    await apply(item.handle);
  }

  async function handleCreateNew(name: string) {
    if (!name) return;
    setApplying(true);
    setError(null);
    try {
      await apply(await getOrCreateTagHandle(await getToken(), name));
    } catch (err: any) {
      setError(err.message ?? String(err));
      setApplying(false);
    }
  }

  const count = handles.length.toLocaleString();
  return (
    <>
      <Button variant="default" size="xs" onClick={() => { setError(null); setOpened(true); }}>
        {t("Tag")}
      </Button>
      <Modal
        opened={opened}
        onClose={() => { if (!applying) setOpened(false); }}
        closeOnClickOutside={!applying}
        closeOnEscape={!applying}
        withCloseButton={!applying}
        title={`${mode === "add" ? t("Adding a tag") : t("Removing a tag")} — ${count} ${t("objects")}`}
        size="sm"
      >
        <Stack gap="md">
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            disabled={applying}
            data={[
              { value: "add", label: t("Add tag") },
              { value: "remove", label: t("Remove tag") },
            ]}
          />
          {error && (
            <Alert color="red" title={mode === "add" ? t("Could not tag") : t("Could not remove the tag")}>
              {error}
            </Alert>
          )}
          {applying && <BulkEditProgressBar progress={progress} />}
          <RecordPicker
            key={mode}
            view={TAG_VIEW}
            searchField="gramps_id"
            placeholder={TAG_VIEW.simpleSearch?.placeholder ?? "Search…"}
            buildExpr={TAG_VIEW.simpleSearch?.buildExpr}
            renderLabel={(item) => pickerResultLabel(TAG_VIEW.key, item)}
            onPick={handlePick}
            confirmWithButton
            {...(mode === "add" ? { createLabel: "tag", onCreateNew: handleCreateNew } : {})}
          />
        </Stack>
      </Modal>
    </>
  );
}
